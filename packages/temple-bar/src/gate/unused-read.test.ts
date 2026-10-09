import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isCommentOnlyFile } from "./unused-read.ts";

void test("file boundary rejects code, unknown extensions, bad encoding, large files, links and outside paths", async () => {
  const folder = await fs.mkdtemp(
    path.join(tmpdir(), "temple-bar-comment-files-"),
  );
  const root = path.join(folder, "project");
  await fs.mkdir(root);
  try {
    for (const extension of [
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "mts",
      "cts",
    ]) {
      const file = path.join(root, `empty.${extension}`);
      await fs.writeFile(file, "/* license */\n");
      assert.equal(await isCommentOnlyFile(root, file), true, extension);
    }
    for (const [name, contents] of [
      ["code.ts", "export {};"],
      ["bad.ts", Buffer.from([0xff])],
      ["large.ts", " ".repeat(1_048_577)],
      ["unknown.svelte", "/* comment */"],
      ["upper.TS", "//comment"],
      ["directive.ts", "/// <reference types='node' />"],
    ] as const) {
      const file = path.join(root, name);
      await fs.writeFile(file, contents);
      assert.equal(await isCommentOnlyFile(root, file), false, name);
    }
    const boundary = path.join(root, "boundary.ts");
    await fs.writeFile(boundary, " ".repeat(1_048_576));
    assert.equal(await isCommentOnlyFile(root, boundary), true);
    const bom = path.join(root, "bom.ts");
    await fs.writeFile(
      bom,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("// license"),
      ]),
    );
    assert.equal(await isCommentOnlyFile(root, bom), true);
    const outside = path.join(folder, "outside.ts");
    await fs.writeFile(outside, "//outside");
    assert.equal(await isCommentOnlyFile(root, outside), false);
    assert.equal(
      await isCommentOnlyFile(root, path.join(root, "missing.ts")),
      false,
    );
    assert.equal(await isCommentOnlyFile(root, "relative.ts"), false);
    await fs.mkdir(path.join(root, "directory.ts"));
    assert.equal(
      await isCommentOnlyFile(root, path.join(root, "directory.ts")),
      false,
    );
    // Windows file symlinks require privileges not granted on all runners.
    if (process.platform !== "win32") {
      const realRoot = await fs.realpath(root);
      const alias = path.join(folder, "alias");
      await fs.symlink(root, alias, "dir");
      assert.equal(
        await isCommentOnlyFile(alias, path.join(realRoot, "empty.ts")),
        true,
      );
      assert.equal(
        await isCommentOnlyFile(realRoot, path.join(alias, "empty.ts")),
        false,
      );
      assert.equal(
        await isCommentOnlyFile(alias, path.join(alias, "empty.ts")),
        true,
      );
      const intermediate = path.join(root, "linked");
      await fs.symlink(root, intermediate, "dir");
      assert.equal(
        await isCommentOnlyFile(root, path.join(intermediate, "empty.ts")),
        false,
      );

      for (const [name, target] of [
        ["inside.ts", path.join(root, "empty.ts")],
        ["outside-link.ts", outside],
      ]) {
        const link = path.join(root, name ?? "");
        await fs.symlink(target ?? "", link);
        assert.equal(await isCommentOnlyFile(root, link), false);
      }
    }
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
