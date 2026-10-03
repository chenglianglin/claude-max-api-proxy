import assert from "node:assert/strict";
import test from "node:test";
import { latestUserPrompt } from "./openai-to-cli.js";

test("resume prompt keeps only the latest user message", () => {
  const prompt = latestUserPrompt([
    { role: "system", content: "be brief" },
    { role: "user", content: "first" },
    { role: "assistant", content: "ack" },
    { role: "user", content: "second" },
  ]);
  assert.equal(prompt, "second");
});

test("resume prompt reads text parts from array content", () => {
  const prompt = latestUserPrompt([
    {
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "there" },
      ],
    },
  ]);
  assert.equal(prompt, "hello\nthere");
});
