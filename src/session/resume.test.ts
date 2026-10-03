import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestartSession } from "./resume.js";

test("missing transcript starts a new session", () => {
  assert.equal(
    shouldRestartSession("No conversation found with session ID abc", false),
    true
  );
});

test("a model error keeps the existing session", () => {
  assert.equal(shouldRestartSession("Process exited with code 1", false), false);
});

test("partial output is not discarded", () => {
  assert.equal(
    shouldRestartSession("No conversation found with session ID abc", true),
    false
  );
});
