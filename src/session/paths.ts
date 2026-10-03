/**
 * Claude Code stores each conversation at:
 * ~/.claude/projects/<cwd-with-non-alphanumerics-replaced-by-dashes>/<session-id>.jsonl
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Directory Claude CLI uses for every persisted proxy session. */
export function sessionWorkspaceDir(): string {
  const configured = process.env.CLAUDE_PROXY_SESSION_CWD?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".claude-max-api-proxy");
}

export function claudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".claude");
}

/** Encode an absolute cwd the same way Claude Code names its project folder. */
export function encodeProjectDir(cwd: string): string {
  return path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

export function sessionTranscriptPath(cwd: string, sessionId: string): string {
  return path.join(
    claudeConfigDir(),
    "projects",
    encodeProjectDir(cwd),
    `${sessionId}.jsonl`
  );
}

export async function sessionTranscriptExists(
  cwd: string,
  sessionId: string
): Promise<boolean> {
  try {
    await fs.access(sessionTranscriptPath(cwd, sessionId));
    return true;
  } catch {
    return false;
  }
}
