import assert from "node:assert/strict";
import test from "node:test";
import { claudeUsageToOpenai, selectCliUsage } from "./usage.js";
import { cliResultToOpenai, createDoneChunk } from "./cli-to-openai.js";
import type { ClaudeCliResult } from "../types/claude-cli.js";

test("prompt tokens include cache writes and cache reads", () => {
  const usage = claudeUsageToOpenai({
    input_tokens: 3,
    cache_creation_input_tokens: 6879,
    cache_read_input_tokens: 13122,
    output_tokens: 12,
  });

  assert.equal(usage.prompt_tokens, 20004);
  assert.equal(usage.completion_tokens, 12);
  assert.equal(usage.total_tokens, 20016);
  assert.equal(usage.prompt_tokens_details?.cached_tokens, 13122);
  assert.equal(usage.cache_creation_input_tokens, 6879);
});

test("camelCase modelUsage fields are accepted", () => {
  const usage = claudeUsageToOpenai({
    inputTokens: 2,
    outputTokens: 13,
    cacheReadInputTokens: 100,
  });
  assert.equal(usage.prompt_tokens, 102);
  assert.equal(usage.completion_tokens, 13);
  assert.equal(usage.total_tokens, 115);
});

test("a fuller assistant usage wins over a partial result", () => {
  const selected = selectCliUsage([
    { input_tokens: 3, output_tokens: 12 },
    {
      input_tokens: 3,
      cache_creation_input_tokens: 6879,
      cache_read_input_tokens: 13122,
      output_tokens: 12,
    },
  ]);
  assert.equal(claudeUsageToOpenai(selected).prompt_tokens, 20004);
});

test("non-streaming response carries the combined usage", () => {
  const result = {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    result: "ok",
    session_id: "s",
    total_cost_usd: 0,
    usage: {
      input_tokens: 3,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
      output_tokens: 4,
    },
  } as ClaudeCliResult;

  const response = cliResultToOpenai(result, "req");
  assert.equal(response.usage.prompt_tokens, 33);
  assert.equal(response.usage.completion_tokens, 4);
  assert.equal(response.usage.total_tokens, 37);
});

test("streaming done chunk includes usage", () => {
  const chunk = createDoneChunk("req", "claude-sonnet-4-6", claudeUsageToOpenai({
    input_tokens: 1,
    output_tokens: 2,
  }));
  assert.equal(chunk.choices[0]?.finish_reason, "stop");
  assert.equal(chunk.usage?.prompt_tokens, 1);
  assert.equal(chunk.usage?.completion_tokens, 2);
  assert.equal(chunk.usage?.total_tokens, 3);
});
