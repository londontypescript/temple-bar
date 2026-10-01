import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeFs } from "../testing/fakes.ts";
import { DEFAULT_CONFIG, readProjectConfig } from "./project-config.ts";

function withConfig(content: string) {
  return createFakeContext({
    fs: createFakeFs({ "/repo/temple-bar.config.json": content }),
  });
}

void test("no config file means every default", async () => {
  assert.deepEqual(
    await readProjectConfig(createFakeContext()),
    DEFAULT_CONFIG,
  );
});

void test("a key in the config overrides only its own default", async () => {
  const config = await readProjectConfig(
    withConfig(JSON.stringify({ maxPullRequestLines: 77 })),
  );
  assert.equal(config.maxPullRequestLines, 77);
  assert.equal(config.maxPullRequestFiles, DEFAULT_CONFIG.maxPullRequestFiles);
  assert.equal(config.maxFileLines, DEFAULT_CONFIG.maxFileLines);
});

void test("a broken config is an error naming the file, never a silent default", async () => {
  for (const content of [
    "{ nope",
    "[]",
    JSON.stringify({ maxPullRequestFiles: 0 }),
    JSON.stringify({ maxPullRequestLines: "100" }),
    JSON.stringify({ maxPullRequestLines: 1.5 }),
  ]) {
    await assert.rejects(
      readProjectConfig(withConfig(content)),
      /temple-bar\.config\.json/,
    );
  }
});
