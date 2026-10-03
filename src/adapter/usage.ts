/**
 * Map Claude CLI token counts onto the OpenAI usage object.
 *
 * Claude reports uncached input separately from cache writes and cache reads.
 * OpenAI clients read prompt_tokens, so those three are added together.
 */

import type { ClaudeTokenUsage } from "../types/claude-cli.js";
import type { OpenAIUsage } from "../types/openai.js";

function count(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function claudeUsageToOpenai(usage: ClaudeTokenUsage | undefined | null): OpenAIUsage {
  const input = count(usage?.input_tokens, usage?.inputTokens);
  const output = count(usage?.output_tokens, usage?.outputTokens);
  const cacheCreation = count(
    usage?.cache_creation_input_tokens,
    usage?.cacheCreationInputTokens
  );
  const cacheRead = count(
    usage?.cache_read_input_tokens,
    usage?.cacheReadInputTokens
  );
  const promptTokens = input + cacheCreation + cacheRead;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: promptTokens + output,
    prompt_tokens_details: {
      cached_tokens: cacheRead,
    },
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  };
}

function addUsage(target: ClaudeTokenUsage, extra: ClaudeTokenUsage): void {
  target.input_tokens = count(target.input_tokens) + count(extra.input_tokens, extra.inputTokens);
  target.output_tokens = count(target.output_tokens) + count(extra.output_tokens, extra.outputTokens);
  target.cache_creation_input_tokens =
    count(target.cache_creation_input_tokens) +
    count(extra.cache_creation_input_tokens, extra.cacheCreationInputTokens);
  target.cache_read_input_tokens =
    count(target.cache_read_input_tokens) +
    count(extra.cache_read_input_tokens, extra.cacheReadInputTokens);
}

/** Sum per-model usage from a CLI result. */
export function modelUsageToClaude(
  modelUsage: Record<string, ClaudeTokenUsage> | undefined
): ClaudeTokenUsage | undefined {
  if (!modelUsage) return undefined;
  const entries = Object.values(modelUsage);
  if (entries.length === 0) return undefined;

  const total: ClaudeTokenUsage = {};
  for (const entry of entries) addUsage(total, entry);
  return total;
}

/**
 * Pick the usage object that accounts for the most tokens.
 * A result that only carries uncached input_tokens loses to an assistant
 * message that also includes cache reads and writes.
 */
export function selectCliUsage(
  sources: Array<ClaudeTokenUsage | undefined | null>
): ClaudeTokenUsage | undefined {
  let best: ClaudeTokenUsage | undefined;
  let bestTotal = -1;

  for (const source of sources) {
    if (!source) continue;
    const total = claudeUsageToOpenai(source).total_tokens;
    if (total > bestTotal) {
      best = source;
      bestTotal = total;
    }
  }

  return best;
}
