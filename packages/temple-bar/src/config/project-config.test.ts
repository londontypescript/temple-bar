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
  assert.equal(
    config.maxPullRequestTestLines,
    DEFAULT_CONFIG.maxPullRequestTestLines,
  );
  assert.equal(config.maxFileLines, DEFAULT_CONFIG.maxFileLines);
});

void test("test lines have their own limit, read from the config", async () => {
  const config = await readProjectConfig(
    withConfig(JSON.stringify({ maxPullRequestTestLines: 99 })),
  );
  assert.equal(config.maxPullRequestTestLines, 99);
  assert.equal(config.maxPullRequestLines, DEFAULT_CONFIG.maxPullRequestLines);
});

void test("a broken config is an error naming the file, never a silent default", async () => {
  for (const content of [
    "{ nope",
    "[]",
    JSON.stringify({ maxPullRequestFiles: 0 }),
    JSON.stringify({ maxPullRequestLines: "100" }),
    JSON.stringify({ maxPullRequestLines: 1.5 }),
    JSON.stringify({ maxPullRequestTestLines: -1 }),
    JSON.stringify({ coverageExclusions: "src/generated/" }),
    JSON.stringify({ coverageExclusions: ["src/a.ts", ""] }),
    JSON.stringify({ coverageExclusions: ["src/a.ts", 1] }),
    JSON.stringify({ coverageExclusions: null }),
  ]) {
    await assert.rejects(
      readProjectConfig(withConfig(content)),
      /temple-bar\.config\.json/,
    );
  }
});

void test("coverage exclusions are read as given, and none by default", async () => {
  assert.deepEqual(DEFAULT_CONFIG.coverageExclusions, []);
  const config = await readProjectConfig(
    withConfig(
      JSON.stringify({ coverageExclusions: ["src/generated/", "src/a.ts"] }),
    ),
  );
  assert.deepEqual(config.coverageExclusions, ["src/generated/", "src/a.ts"]);
  assert.equal(config.maxFileLines, DEFAULT_CONFIG.maxFileLines);
});

void test("an exclusion list that isn't non-empty paths is refused with the file's usual error", async () => {
  await assert.rejects(
    readProjectConfig(withConfig(JSON.stringify({ coverageExclusions: [""] }))),
    {
      message:
        'temple-bar.config.json: "coverageExclusions" must be a list of non-empty paths',
    },
  );
});
