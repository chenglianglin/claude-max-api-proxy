import assert from "node:assert/strict";
import test from "node:test";
import { applyEnv, parseEnv } from "./load-env.js";

test("parseEnv reads assignments and ignores comments", () => {
  const parsed = parseEnv(`
# comment
export CLAUDE_PROXY_SESSION_CWD=/tmp/sessions
CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS="true"
EMPTY=
`);
  assert.equal(parsed.CLAUDE_PROXY_SESSION_CWD, "/tmp/sessions");
  assert.equal(parsed.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS, "true");
  assert.equal(parsed.EMPTY, "");
});

test("applyEnv keeps variables that are already set", () => {
  const target: NodeJS.ProcessEnv = {
    CLAUDE_PROXY_SESSION_CWD: "/keep/me",
  };
  const applied = applyEnv(
    {
      CLAUDE_PROXY_SESSION_CWD: "/from/env/file",
      CLAUDE_CONFIG_DIR: "/from/env/file",
    },
    target
  );
  assert.deepEqual(applied, ["CLAUDE_CONFIG_DIR"]);
  assert.equal(target.CLAUDE_PROXY_SESSION_CWD, "/keep/me");
  assert.equal(target.CLAUDE_CONFIG_DIR, "/from/env/file");
});
