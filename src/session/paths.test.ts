import assert from "node:assert/strict";
import test from "node:test";
import { encodeProjectDir, isUuid } from "./paths.js";

test("encodeProjectDir matches Claude Code project folder names", () => {
  assert.equal(encodeProjectDir("/Users/shouavi/tmp"), "-Users-shouavi-tmp");
  assert.equal(
    encodeProjectDir("/Users/shouavi/llm-benhmark"),
    "-Users-shouavi-llm-benhmark"
  );
});

test("isUuid accepts session ids Claude will take", () => {
  assert.equal(isUuid("206f4c71-9a32-4c3b-b8d1-9b94387ede84"), true);
  assert.equal(isUuid("my-session"), false);
});
