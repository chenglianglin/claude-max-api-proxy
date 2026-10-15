import assert from "node:assert/strict";
import test from "node:test";
import { callerUserIdFromSessionKey, resolveClientSessionKey } from "./key.js";

test("header overrides the OpenAI user field", () => {
  assert.deepEqual(resolveClientSessionKey(" chat-1 ", "other"), {
    key: "chat-1",
  });
});

test("user field is the key when the header is empty", () => {
  assert.deepEqual(resolveClientSessionKey("  ", "conv-abc"), {
    key: "conv-abc",
  });
});

test("missing key stays stateless", () => {
  assert.deepEqual(resolveClientSessionKey(undefined, "  "), {});
});

test("user id is the part before the colon", () => {
  assert.equal(callerUserIdFromSessionKey("3f2a:9c1b"), "3f2a");
  assert.equal(callerUserIdFromSessionKey(" 3f2a : 9c1b "), "3f2a");
  assert.equal(callerUserIdFromSessionKey("my-session"), undefined);
  assert.equal(callerUserIdFromSessionKey(":chat"), undefined);
  assert.equal(callerUserIdFromSessionKey("user:"), undefined);
});

test("rejects keys Claude would not keep as one mapping", () => {
  const result = resolveClientSessionKey(undefined, "line\nbreak");
  assert.equal(typeof result.error, "string");
});

test("x-user-id namespaces the session key", () => {
  assert.deepEqual(resolveClientSessionKey("chat-1", undefined, "alice"), {
    key: "alice:chat-1",
  });
  assert.notDeepEqual(
    resolveClientSessionKey("chat-1", undefined, "alice"),
    resolveClientSessionKey("chat-1", undefined, "bob")
  );
});

test("x-user-id alone gives one session per user", () => {
  assert.deepEqual(resolveClientSessionKey(undefined, undefined, " alice "), {
    key: "alice",
  });
});
