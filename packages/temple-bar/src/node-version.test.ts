import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MIN_NODE_MAJOR, nodeTooOldMessage } from "./node-version.ts";

void test("the minimum Node is the one this package declares in engines.node", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { engines: { node: string } };
  assert.equal(manifest.engines.node, `>=${String(MIN_NODE_MAJOR)}`);
});

void test("an older Node is named with its path, what is needed and the fix", () => {
  const message = nodeTooOldMessage("22.12.0", "/old/bin/node");
  assert.ok(message !== undefined);
  assert.match(message, /needs Node 24 or newer, but this is Node 22\.12\.0/);
  assert.match(message, /\(\/old\/bin\/node\)/);
  assert.match(message, /Nothing was changed/);
  assert.match(message, /terminal, editor or desktop app/);
  assert.match(message, /restarted to pick up a new PATH/);
});

void test("the minimum and anything newer, with or without a leading v, passes", () => {
  assert.equal(nodeTooOldMessage("24.0.0", "/n"), undefined);
  assert.equal(nodeTooOldMessage("v26.1.0", "/n"), undefined);
});

void test("a version that can't be read is not blocked", () => {
  assert.equal(nodeTooOldMessage("", "/n"), undefined);
  assert.equal(nodeTooOldMessage("nonsense", "/n"), undefined);
});
