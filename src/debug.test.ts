import assert from "node:assert/strict";
import test from "node:test";
import { isDebugEnabled } from "./debug.js";

test("debug is off for 0 and unset", () => {
  assert.equal(isDebugEnabled(undefined), false);
  assert.equal(isDebugEnabled("0"), false);
  assert.equal(isDebugEnabled("false"), false);
  assert.equal(isDebugEnabled(""), false);
});

test("debug is on for 1 and true", () => {
  assert.equal(isDebugEnabled("1"), true);
  assert.equal(isDebugEnabled("true"), true);
  assert.equal(isDebugEnabled(" yes "), true);
});
