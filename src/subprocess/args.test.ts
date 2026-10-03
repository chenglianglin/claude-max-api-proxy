import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudeArgs } from "./manager.js";

const id = "206f4c71-9a32-4c3b-b8d1-9b94387ede84";

test("stateless calls do not leave a resumable session", () => {
  const args = buildClaudeArgs({ model: "sonnet" });
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args.includes("--resume"), false);
  assert.equal(args.includes("--session-id"), false);
});

test("create persists a chosen session id", () => {
  const args = buildClaudeArgs({
    model: "sonnet",
    session: { mode: "create", id },
  });
  assert.equal(args.includes("--no-session-persistence"), false);
  assert.deepEqual(args.slice(args.indexOf("--session-id"), args.indexOf("--session-id") + 2), [
    "--session-id",
    id,
  ]);
});

test("resume continues that same session id", () => {
  const args = buildClaudeArgs({
    model: "sonnet",
    session: { mode: "resume", id },
  });
  assert.equal(args.includes("--no-session-persistence"), false);
  assert.deepEqual(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2), [
    "--resume",
    id,
  ]);
});
