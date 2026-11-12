// The note for a public repository with no licence: a note, never a
// failure, and only when the root shows no licence file.

import assert from "node:assert/strict";
import test from "node:test";

import { licenseNote } from "./github-repo.ts";
import { createFakeContext, createFakeFs } from "../testing/fakes.ts";

void test("the LICENSE note appears with no licence file, never with one, and never when the root can't be listed", async () => {
  const without = createFakeContext({
    fs: createFakeFs({ "/repo/README.md": "x" }),
  });
  assert.match((await licenseNote(without, "/repo")) ?? "", /no LICENSE file/);
  for (const name of [
    "LICENSE",
    "licence.md",
    "COPYING",
    "UNLICENSE",
    "LICENSE-MIT",
  ]) {
    const ctx = createFakeContext({
      fs: createFakeFs({ [`/repo/${name}`]: "x" }),
    });
    assert.equal(await licenseNote(ctx, "/repo"), undefined, name);
  }
  const fs = createFakeFs();
  fs.globErrors.set("*", new Error("EACCES"));
  assert.equal(
    await licenseNote(createFakeContext({ fs }), "/repo"),
    undefined,
  );
});
