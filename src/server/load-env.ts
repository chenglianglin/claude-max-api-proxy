/**
 * Load .env without replacing variables that are already set.
 * The process environment and the current working directory win over the
 * project file, so a local .env and the shell both keep their values.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function parseEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

/** Fill only keys that are still missing. Returns the keys that were added. */
export function applyEnv(
  parsed: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env
): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    applied.push(key);
  }
  return applied;
}

export function envFileCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectFile = path.resolve(here, "../..", ".env");
  const cwdFile = path.resolve(process.cwd(), ".env");
  return cwdFile === projectFile ? [cwdFile] : [cwdFile, projectFile];
}

export function loadEnvFiles(): string[] {
  const applied: string[] = [];
  for (const file of envFileCandidates()) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const added = applyEnv(parseEnv(text));
    if (added.length > 0) {
      console.error(`[env] Kept ${added.length} variables from ${file}`);
      applied.push(...added);
    }
  }
  return applied;
}

loadEnvFiles();
