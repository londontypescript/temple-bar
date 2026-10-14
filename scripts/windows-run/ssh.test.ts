import assert from "node:assert/strict";
import { test } from "node:test";

import { main } from "./remote/main.ts";
import { scpArgs, sshArgs } from "./ssh.ts";

void test("ssh and scp never prompt, give up connecting, and notice a stalled connection", () => {
  for (const args of [
    sshArgs("box", ["node", "x"]),
    scpArgs("box", "/tmp/a", "dest/", true),
  ]) {
    const text = args.join(" ");
    assert.match(text, /-o BatchMode=yes/);
    assert.match(text, /-o ConnectTimeout=15/);
    assert.match(text, /-o ServerAliveInterval=15 -o ServerAliveCountMax=4/);
    // The host comes after `--`, so it can never be read as an option.
    assert.ok(
      args.indexOf("--") < args.findIndex((arg) => arg.includes("box")),
    );
  }
  assert.deepEqual(sshArgs("box", ["node", "x"]).slice(-3), [
    "box",
    "node",
    "x",
  ]);
  assert.equal(scpArgs("box", "/tmp/a", "dest/", false).at(-1), "box:dest/");
});

void test("the Windows entry point refuses anything but a run id and a commit", async () => {
  for (const args of [
    [],
    ["a1b2c3d4"],
    ["a1b2c3d4; calc", "0".repeat(40)],
    ["a1b2c3d4", "x"],
    ["a1b2c3d4", "0".repeat(40), "extra"],
  ]) {
    assert.equal(await main(args), 2);
  }
});
