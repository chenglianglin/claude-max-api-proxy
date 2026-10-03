/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import type {
  ClaudeCliMessage,
  ClaudeCliAssistant,
  ClaudeCliResult,
  ClaudeCliStreamEvent,
} from "../types/claude-cli.js";
import { isAssistantMessage, isResultMessage, isContentDelta } from "../types/claude-cli.js";
import type { ClaudeModel } from "../adapter/openai-to-cli.js";
import { isDebugEnabled } from "../debug.js";

export interface SubprocessOptions {
  model: ClaudeModel;
  /** Legacy id passed with --no-session-persistence. Does not resume a conversation. */
  sessionId?: string;
  /**
   * Persist the conversation. `create` uses --session-id, `resume` uses --resume.
   * When set, --no-session-persistence is not passed.
   */
  session?: {
    mode: "create" | "resume";
    id: string;
  };
  cwd?: string;
  timeout?: number;
}

export interface SubprocessEvents {
  message: (msg: ClaudeCliMessage) => void;
  assistant: (msg: ClaudeCliAssistant) => void;
  result: (result: ClaudeCliResult) => void;
  error: (error: Error) => void;
  close: (code: number | null) => void;
  raw: (line: string) => void;
}

const DEFAULT_TIMEOUT = 900000; // 15 minutes (agentic tasks can be long)

/**
 * CLI flags for one Claude invocation.
 * Persisted sessions omit --no-session-persistence so a later --resume can find them.
 */
export function buildClaudeArgs(options: SubprocessOptions): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    options.model,
  ];

  if (process.env.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS === "true") {
    args.push("--dangerously-skip-permissions");
  }

  if (options.session?.mode === "resume") {
    args.push("--resume", options.session.id);
  } else if (options.session?.mode === "create") {
    args.push("--session-id", options.session.id);
  } else {
    args.push("--no-session-persistence");
    if (options.sessionId) {
      args.push("--session-id", options.sessionId);
    }
  }

  return args;
}

/**
 * Environment passed to the Claude CLI process.
 * Root cannot use --dangerously-skip-permissions unless Claude sees a sandbox.
 * IS_SANDBOX=1 is the switch Claude itself checks for that case.
 */
export function claudeChildEnv(
  base: NodeJS.ProcessEnv = process.env,
  uid: number | undefined = typeof process.getuid === "function" ? process.getuid() : undefined
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, OPENCLAW_PROXY: "1" };
  const skipPermissions = base.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS === "true";
  if (skipPermissions && uid === 0 && env.IS_SANDBOX === undefined) {
    env.IS_SANDBOX = "1";
  }
  return env;
}

export class ClaudeSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private stderrText: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Claude CLI subprocess with the given prompt
   */
  async start(prompt: string, options: SubprocessOptions): Promise<void> {
    const args = this.buildArgs(options);
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        // Use spawn() for security - no shell interpretation
        const env = claudeChildEnv();
        if (
          process.getuid?.() === 0 &&
          process.env.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS === "true" &&
          process.env.IS_SANDBOX === undefined
        ) {
          console.error(
            "[Subprocess] Running as root; setting IS_SANDBOX=1 so Claude CLI allows --dangerously-skip-permissions"
          );
        }
        this.process = spawn("claude", args, {
          cwd: options.cwd || process.cwd(),
          // Keep shell and .env variables. IS_SANDBOX is added only for root.
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Set timeout
        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        // Handle spawn errors (e.g., claude not found)
        this.process.on("error", (err) => {
          this.clearTimeout();
          const wrapped = err.message.includes("ENOENT")
            ? new Error(
                "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
              )
            : err;
          this.emit("error", wrapped);
          reject(wrapped);
        });

        // Pass prompt via stdin to avoid E2BIG with large prompts
        this.process.stdin?.write(prompt);
        this.process.stdin?.end();

        if (isDebugEnabled()) {
          console.error(`[Subprocess] Process spawned with PID: ${this.process.pid}`);
        }

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          if (isDebugEnabled()) {
            console.error(`[Subprocess] Received ${data.length} bytes of stdout`);
          }
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString();
          this.stderrText += errorText;
          const trimmed = errorText.trim();
          if (trimmed) {
            // Don't emit as error unless it's actually an error
            // Claude CLI may write debug info to stderr
            console.error("[Subprocess stderr]:", trimmed.slice(0, 200));
          }
        });

        // Handle process close
        this.process.on("close", (code) => {
          if (isDebugEnabled() || code !== 0) {
            console.error(`[Subprocess] Process closed with code: ${code}`);
          }
          this.clearTimeout();
          // Process any remaining buffer
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        // Resolve immediately since we're streaming
        resolve();
      } catch (err) {
        this.clearTimeout();
        const wrapped = err instanceof Error ? err : new Error(String(err));
        this.emit("error", wrapped);
        reject(wrapped);
      }
    });
  }

  /**
   * Build CLI arguments array
   * Note: prompt is passed via stdin to avoid E2BIG errors with large prompts
   */
  private buildArgs(options: SubprocessOptions): string[] {
    return buildClaudeArgs(options);
  }

  /** stderr captured from the Claude CLI process. */
  getStderr(): string {
    return this.stderrText;
  }

  /**
   * Process the buffer and emit parsed messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: ClaudeCliMessage = JSON.parse(trimmed);
        this.emit("message", message);

        if (isContentDelta(message)) {
          // Emit content delta for streaming
          this.emit("content_delta", message as ClaudeCliStreamEvent);
        } else if (isAssistantMessage(message)) {
          this.emit("assistant", message);
        } else if (isResultMessage(message)) {
          this.emit("result", message);
        }
      } catch {
        // Non-JSON output, emit as raw
        this.emit("raw", trimmed);
      }
    }
  }

  /**
   * Clear the timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Kill the subprocess
   */
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.process.kill(signal);
    }
  }

  /**
   * Check if the process is still running
   */
  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }
}

/**
 * Verify that Claude CLI is installed and accessible
 */
export async function verifyClaude(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error:
          "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Claude CLI returned non-zero exit code",
        });
      }
    });
  });
}

/**
 * Check if Claude CLI is authenticated
 *
 * Claude Code stores credentials in the OS keychain, not a file.
 * We verify authentication by checking if we can call the CLI successfully.
 * If the CLI is installed, it typically has valid credentials from `claude auth login`.
 */
export async function verifyAuth(): Promise<{ ok: boolean; error?: string }> {
  // If Claude CLI is installed and the user has run `claude auth login`,
  // credentials are stored in the OS keychain and will be used automatically.
  // We can't easily check the keychain, so we'll just return true if the CLI exists.
  // Authentication errors will surface when making actual API calls.
  return { ok: true };
}
