/**
 * Session Manager
 *
 * Maps Clawdbot conversation IDs to Claude CLI session IDs
 * for maintaining conversation context across requests.
 */

import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import {
  isUuid,
  sessionTranscriptExists,
  sessionWorkspaceDir,
} from "./paths.js";

export interface SessionMapping {
  clawdbotId: string;
  claudeSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  model: string;
  /** cwd used for this Claude session. Resume only works from this directory. */
  cwd?: string;
}

export interface SessionPlan {
  clientKey: string;
  claudeSessionId: string;
  mode: "create" | "resume";
  cwd: string;
}

const SESSION_FILE = path.join(
  process.env.HOME || "/tmp",
  ".claude-code-cli-sessions.json"
);

// Session TTL: 24 hours
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

class SessionManager {
  private sessions: Map<string, SessionMapping> = new Map();
  private loaded: boolean = false;
  private loading: Promise<void> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private queueTails = new Map<string, Promise<void>>();

  /**
   * Load sessions from disk
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.readSessions();
    }
    await this.loading;
  }

  private async readSessions(): Promise<void> {
    try {
      const data = await fs.readFile(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data) as Record<string, SessionMapping>;
      this.sessions = new Map(Object.entries(parsed));
      console.log(`[SessionManager] Loaded ${this.sessions.size} sessions`);
    } catch {
      // File doesn't exist or is invalid, start fresh
      this.sessions = new Map();
    } finally {
      this.loaded = true;
    }
  }

  /**
   * Save sessions to disk
   */
  async save(): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const data = Object.fromEntries(this.sessions);
      await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
    });
    // A failed write must not block later saves.
    this.saveQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Run tasks for one client key one at a time so two requests cannot
   * create or resume the same Claude session together.
   */
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queueTails.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    this.queueTails.set(
      key,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  /**
   * Map a client key to a Claude session.
   * Resume when the transcript file is still on disk; otherwise create it.
   */
  async resolve(clientKey: string, model: string): Promise<SessionPlan> {
    await this.load();
    const existing = this.sessions.get(clientKey);
    const cwd = existing?.cwd ?? sessionWorkspaceDir();
    await fs.mkdir(cwd, { recursive: true });

    const claudeSessionId =
      existing?.claudeSessionId ??
      (isUuid(clientKey) ? clientKey : uuidv4());
    const exists = await sessionTranscriptExists(cwd, claudeSessionId);
    const now = Date.now();

    this.sessions.set(clientKey, {
      clawdbotId: clientKey,
      claudeSessionId,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
      model,
      cwd,
    });
    await this.save();

    const mode = exists ? "resume" : "create";
    console.error(
      `[SessionManager] ${mode} ${claudeSessionId} (${this.sessions.size} mapped)`
    );

    return { clientKey, claudeSessionId, mode, cwd };
  }

  /**
   * Drop the Claude id for this key and allocate a new one.
   * Used when --resume fails because the transcript is gone or unusable.
   */
  async replace(clientKey: string, model: string): Promise<SessionPlan> {
    await this.load();
    const prev = this.sessions.get(clientKey);
    const cwd = prev?.cwd ?? sessionWorkspaceDir();
    await fs.mkdir(cwd, { recursive: true });

    const claudeSessionId = uuidv4();
    const now = Date.now();
    this.sessions.set(clientKey, {
      clawdbotId: clientKey,
      claudeSessionId,
      createdAt: prev?.createdAt ?? now,
      lastUsedAt: now,
      model,
      cwd,
    });
    await this.save();
    console.error(`[SessionManager] replace ${claudeSessionId}`);

    return { clientKey, claudeSessionId, mode: "create", cwd };
  }

  /**
   * Get or create a Claude session ID for a Clawdbot conversation
   */
  getOrCreate(clawdbotId: string, model: string = "sonnet"): string {
    const existing = this.sessions.get(clawdbotId);

    if (existing) {
      // Update last used time
      existing.lastUsedAt = Date.now();
      existing.model = model;
      return existing.claudeSessionId;
    }

    // Create new session
    const claudeSessionId = uuidv4();
    const mapping: SessionMapping = {
      clawdbotId,
      claudeSessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      model,
    };

    this.sessions.set(clawdbotId, mapping);
    console.log(
      `[SessionManager] Created session: ${clawdbotId} -> ${claudeSessionId}`
    );

    // Fire and forget save
    this.save().catch((err) =>
      console.error("[SessionManager] Save error:", err)
    );

    return claudeSessionId;
  }

  /**
   * Get existing session if it exists
   */
  get(clawdbotId: string): SessionMapping | undefined {
    return this.sessions.get(clawdbotId);
  }

  /**
   * Delete a session
   */
  delete(clawdbotId: string): boolean {
    const deleted = this.sessions.delete(clawdbotId);
    if (deleted) {
      this.save().catch((err) =>
        console.error("[SessionManager] Save error:", err)
      );
    }
    return deleted;
  }

  /**
   * Clean up expired sessions
   */
  async cleanup(): Promise<number> {
    await this.load();
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;

    for (const [key, session] of this.sessions) {
      if (session.lastUsedAt >= cutoff) continue;
      // Keep the mapping while Claude still has the transcript, so the same
      // client key resumes that conversation after the TTL window.
      const stillThere = session.cwd
        ? await sessionTranscriptExists(session.cwd, session.claudeSessionId)
        : false;
      if (!stillThere) {
        this.sessions.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[SessionManager] Cleaned up ${removed} expired sessions`);
      this.save().catch((err) =>
        console.error("[SessionManager] Save error:", err)
      );
    }

    return removed;
  }

  /**
   * Get all active sessions
   */
  getAll(): SessionMapping[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  get size(): number {
    return this.sessions.size;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

// Initialize on module load
sessionManager.load().catch((err) =>
  console.error("[SessionManager] Load error:", err)
);

// Periodic cleanup every hour
setInterval(() => {
  sessionManager.cleanup().catch((err) =>
    console.error("[SessionManager] Cleanup error:", err)
  );
}, 60 * 60 * 1000).unref();
