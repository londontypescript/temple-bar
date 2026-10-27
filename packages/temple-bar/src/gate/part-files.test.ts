// The part reports' real way to the disk, in a temp folder: a report is
// created only where nothing is, and entries are seen as they are, links
// never followed.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRealPartFiles } from "./part-files.ts";

void test("part files: a new report is created, but never over a file or a dangling link", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-part-files-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const files = createRealPartFiles();

  await files.createNew(path.join(dir, "new.json"), "{}\n");
  assert.equal(readFileSync(path.join(dir, "new.json"), "utf8"), "{}\n");

  writeFileSync(path.join(dir, "old.json"), "earlier\n");
  await assert.rejects(files.createNew(path.join(dir, "old.json"), "{}\n"), {
    code: "EEXIST",
  });
  assert.equal(readFileSync(path.join(dir, "old.json"), "utf8"), "earlier\n");

  // Windows makes links only with a privilege a test can't count on.
  if (process.platform !== "win32") {
    symlinkSync(path.join(dir, "absent"), path.join(dir, "dangling.json"));
    await assert.rejects(
      files.createNew(path.join(dir, "dangling.json"), "{}\n"),
      { code: "EEXIST" },
    );
  }
});

void test("part files: lists a folder's direct entries and says what each is, without following links", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-part-files-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const files = createRealPartFiles();
  writeFileSync(path.join(dir, "a.json"), "{}");
  mkdirSync(path.join(dir, "sub"));
  writeFileSync(path.join(dir, "sub", "deeper.json"), "{}");

  assert.deepEqual((await files.list(dir)).sort(), ["a.json", "sub"]);
  assert.equal(await files.kind(path.join(dir, "a.json")), "file");
  assert.equal(await files.kind(path.join(dir, "sub")), "directory");
  assert.equal(await files.kind(path.join(dir, "none")), "missing");
  assert.equal(await files.read(path.join(dir, "a.json")), "{}");
  if (process.platform !== "win32") {
    symlinkSync(path.join(dir, "a.json"), path.join(dir, "link.json"));
    assert.equal(await files.kind(path.join(dir, "link.json")), "symlink");
  }
});
