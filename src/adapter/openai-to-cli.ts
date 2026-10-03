/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest, OpenAIMessageContent } from "../types/openai.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku" | string;

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  /** Stable client key. Mapped to a Claude session id; not passed to the CLI as-is. */
  sessionKey?: string;
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-4": "haiku",
  // 4.5/4.6 generation
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-haiku-4-5": "claude-haiku-4-5",
  // With provider prefix (claude-code-cli/)
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  "claude-code-cli/claude-opus-4-6": "claude-opus-4-6",
  "claude-code-cli/claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-code-cli/claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-code-cli/claude-haiku-4-5": "claude-haiku-4-5",
  // With provider prefix (claude-proxy/)
  "claude-proxy/claude-opus-4": "opus",
  "claude-proxy/claude-sonnet-4": "sonnet",
  "claude-proxy/claude-haiku-4": "haiku",
  "claude-proxy/claude-opus-4-6": "claude-opus-4-6",
  "claude-proxy/claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-proxy/claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-proxy/claude-haiku-4-5": "claude-haiku-4-5",
  // Short aliases
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
};

/**
 * Extract Claude model alias from request model string
 */
export function extractModel(model: string): ClaudeModel {
  // Try direct lookup
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }

  // Try stripping provider prefix
  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) {
    return MODEL_MAP[stripped];
  }

  // Default to opus (Claude Max subscription)
  return "opus";
}

/**
 * Extract text from OpenAI message content (handles string, array, and null)
 */
function extractContentText(content: OpenAIMessageContent): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .filter((part): part is typeof part & { text: string } =>
        part.type === "text" && typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("\n");
  }
  return String(content);
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const text = extractContentText(msg.content);
    if (!text) continue;

    switch (msg.role) {
      case "system":
      case "developer":
        // System/developer messages become context instructions
        parts.push(`<system>\n${text}\n</system>\n`);
        break;

      case "user":
        // User messages are the main prompt
        parts.push(text);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * Latest user turn only. Used when resuming a Claude session so the
 * transcript is not appended a second time.
 */
export function latestUserPrompt(messages: OpenAIChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const text = extractContentText(msg.content).trim();
    if (text) return text;
  }
  return "";
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  return {
    prompt: messagesToPrompt(request.messages),
    model: extractModel(request.model),
    sessionKey: request.user?.trim() || undefined,
  };
}
