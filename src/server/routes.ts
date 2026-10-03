/**
 * API Route Handlers
 *
 * Implements OpenAI-compatible endpoints for Clawdbot integration
 */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { ClaudeSubprocess, type SubprocessOptions } from "../subprocess/manager.js";
import { extractModel, latestUserPrompt, messagesToPrompt } from "../adapter/openai-to-cli.js";
import {
  cliResultToOpenai,
  createDoneChunk,
  usageForResult,
} from "../adapter/cli-to-openai.js";
import type { OpenAIChatRequest } from "../types/openai.js";
import type { ClaudeCliAssistant, ClaudeCliResult, ClaudeCliStreamEvent, ClaudeTokenUsage } from "../types/claude-cli.js";
import { sessionManager, type SessionPlan } from "../session/manager.js";
import { resolveClientSessionKey } from "../session/key.js";
import { shouldRestartSession } from "../session/resume.js";

/**
 * Handle POST /v1/chat/completions
 *
 * Main endpoint for chat requests, supports both streaming and non-streaming
 */
export async function handleChatCompletions(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as OpenAIChatRequest;
  const stream = body.stream === true;

  try {
    // Validate request
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      });
      return;
    }

    const keyResult = resolveClientSessionKey(
      req.header("x-claude-session-key") ?? undefined,
      body.user
    );
    if (keyResult.error) {
      res.status(400).json({
        error: {
          message: keyResult.error,
          type: "invalid_request_error",
          code: "invalid_session_key",
        },
      });
      return;
    }

    const run = () =>
      runChatCompletion(res, body, requestId, stream, keyResult.key);

    if (keyResult.key) {
      await sessionManager.runExclusive(keyResult.key, run);
    } else {
      await run();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[handleChatCompletions] Error:", message);

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message,
          type: "server_error",
          code: null,
        },
      });
    }
  }
}

interface CliOutcome {
  ok: boolean;
  sentContent: boolean;
  result: ClaudeCliResult | null;
  message: string;
  model: string;
  assistantUsage?: ClaudeTokenUsage;
}

function sessionOptions(plan: SessionPlan | undefined, model: string): SubprocessOptions {
  return {
    model,
    cwd: plan?.cwd,
    session: plan
      ? { mode: plan.mode, id: plan.claudeSessionId }
      : undefined,
  };
}

function setSessionHeaders(res: Response, plan: SessionPlan | undefined): void {
  if (!plan || res.headersSent) return;
  res.setHeader("X-Claude-Session-Id", plan.claudeSessionId);
  res.setHeader("X-Claude-Session-Mode", plan.mode);
}

function resultText(result: ClaudeCliResult | null): string {
  if (!result || typeof result.result !== "string") return "";
  return result.result;
}

/**
 * Run one Claude CLI process. Listeners are attached before start.
 */
function executeClaude(
  prompt: string,
  options: SubprocessOptions,
  onDelta: (text: string) => void,
  onModel: (model: string) => void,
  onSpawn: (subprocess: ClaudeSubprocess) => void
): Promise<CliOutcome> {
  const subprocess = new ClaudeSubprocess();
  onSpawn(subprocess);

  const outcome = new Promise<CliOutcome>((resolve) => {
    let sentContent = false;
    let result: ClaudeCliResult | null = null;
    let model = "claude-sonnet-4";
    let assistantUsage: ClaudeTokenUsage | undefined;
    let settled = false;

    const finish = (ok: boolean, message: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, sentContent, result, message, model, assistantUsage });
    };

    subprocess.on("content_delta", (event: ClaudeCliStreamEvent) => {
      const text = event.event.delta?.text || "";
      if (!text) return;
      sentContent = true;
      onDelta(text);
    });

    subprocess.on("assistant", (message: ClaudeCliAssistant) => {
      model = message.message.model;
      onModel(model);
      if (message.message.usage) assistantUsage = message.message.usage;
    });

    subprocess.on("result", (message: ClaudeCliResult) => {
      result = message;
      if (message.is_error || message.subtype === "error") {
        finish(false, resultText(message) || "Claude CLI returned an error");
        return;
      }
      finish(true, "");
    });

    subprocess.on("error", (error: Error) => {
      finish(false, error.message);
    });

    subprocess.on("close", (code: number | null) => {
      if (settled) return;
      const stderr = subprocess.getStderr().trim();
      finish(false, stderr || `Process exited with code ${code}`);
    });
  });

  subprocess.start(prompt, options).catch((err) => {
    console.error("[Subprocess] start failed:", err);
  });

  return outcome;
}

async function runChatCompletion(
  res: Response,
  body: OpenAIChatRequest,
  requestId: string,
  stream: boolean,
  sessionKey: string | undefined
): Promise<void> {
  const model = extractModel(body.model);
  const fullPrompt = messagesToPrompt(body.messages);
  let plan = sessionKey
    ? await sessionManager.resolve(sessionKey, model)
    : undefined;

  if (plan?.mode === "resume" && !latestUserPrompt(body.messages)) {
    res.status(400).json({
      error: {
        message: "A user message is required to continue a session",
        type: "invalid_request_error",
        code: "invalid_messages",
      },
    });
    return;
  }

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Request-Id", requestId);
    setSessionHeaders(res, plan);
    res.flushHeaders();
    res.write(":ok\n\n");
  }

  let clientGone = false;
  let succeeded = false;
  let active: ClaudeSubprocess | null = null;
  res.on("close", () => {
    if (!succeeded) {
      clientGone = true;
      active?.kill();
    }
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      plan?.mode === "resume" ? latestUserPrompt(body.messages) : fullPrompt;
    let isFirst = true;
    let lastModel = "claude-sonnet-4";

    const outcome = await executeClaude(
      prompt,
      sessionOptions(plan, model),
      (text) => {
        if (!stream || res.writableEnded || clientGone) return;
        const chunk = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: lastModel,
          choices: [{
            index: 0,
            delta: {
              role: isFirst ? "assistant" as const : undefined,
              content: text,
            },
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        isFirst = false;
      },
      (nextModel) => {
        lastModel = nextModel;
      },
      (subprocess) => {
        active = subprocess;
      }
    );
    if (outcome.model) lastModel = outcome.model;

    if (clientGone) return;

    if (outcome.ok && outcome.result) {
      succeeded = true;
      if (stream) {
        if (!res.writableEnded) {
          const usage = usageForResult(outcome.result, outcome.assistantUsage);
          res.write(`data: ${JSON.stringify(createDoneChunk(requestId, lastModel, usage))}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      } else {
        setSessionHeaders(res, plan);
        const response = cliResultToOpenai(outcome.result, requestId);
        response.usage = usageForResult(outcome.result, outcome.assistantUsage);
        res.json(response);
      }
      return;
    }

    const retry =
      attempt === 0 &&
      plan?.mode === "resume" &&
      Boolean(sessionKey) &&
      shouldRestartSession(outcome.message, outcome.sentContent);

    if (retry && sessionKey) {
      console.error(
        "[Session] resume failed, starting a new session:",
        outcome.message.slice(0, 300)
      );
      plan = await sessionManager.replace(sessionKey, model);
      if (stream && !res.writableEnded) {
        res.write(`: new-session ${plan.claudeSessionId}\n\n`);
      }
      continue;
    }

    succeeded = true;
    const message = outcome.message || "Claude CLI failed";
    console.error("[handleChatCompletions] Claude CLI failed:", message.slice(0, 300));
    if (stream) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          error: { message, type: "server_error", code: null },
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } else if (!res.headersSent) {
      setSessionHeaders(res, plan);
      res.status(500).json({
        error: {
          message,
          type: "server_error",
          code: null,
        },
      });
    }
    return;
  }
}

/**
 * Handle GET /v1/models
 *
 * Returns available models
 */
export function handleModels(_req: Request, res: Response): void {
  res.json({
    object: "list",
    data: [
      {
        id: "claude-opus-4",
        object: "model",
        owned_by: "anthropic",
        created: Math.floor(Date.now() / 1000),
      },
      {
        id: "claude-sonnet-4",
        object: "model",
        owned_by: "anthropic",
        created: Math.floor(Date.now() / 1000),
      },
      {
        id: "claude-haiku-4",
        object: "model",
        owned_by: "anthropic",
        created: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * Handle GET /health
 *
 * Health check endpoint
 */
export function handleHealth(_req: Request, res: Response): void {
  res.json({
    status: "ok",
    provider: "claude-code-cli",
    timestamp: new Date().toISOString(),
  });
}
