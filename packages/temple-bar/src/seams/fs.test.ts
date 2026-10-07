import assert from "node:assert/strict";
import {
  promises as fsp,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createFsSeam } from "./fs.ts";
import { realLink } from "../init/testing/write-target-repo.ts";

void test("fs seam: readText returns undefined for a missing file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const result = await fs.readText(path.join(dir, "missing.txt"));
    assert.equal(result, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: no-follow classification distinguishes files, folders, live and dangling links", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-classify-"));
  try {
    const fs = createFsSeam();
    writeFileSync(path.join(dir, "file"), "bytes");
    realLink("file", path.join(dir, "live"));
    realLink("missing", path.join(dir, "dangling"));
    realLink(dir, path.join(dir, "folder-link"), true);
    assert.equal(await fs.classify(dir), "directory");
    assert.equal(await fs.classify(path.join(dir, "file")), "file");
    assert.equal(await fs.classify(path.join(dir, "missing")), "missing");
    for (const name of ["live", "dangling", "folder-link"])
      assert.equal(await fs.classify(path.join(dir, name)), "symlink");
    assert.equal(await fs.readlink(path.join(dir, "dangling")), "missing");
    const child = path.join(dir, "file", "child");
    let code: unknown;
    try {
      await fsp.lstat(child);
    } catch (error) {
      code = error instanceof Error && "code" in error ? error.code : undefined;
    }
    assert.equal(
      typeof code,
      "string",
      "the filesystem refuses a file's child",
    );
    // Filesystems differ on this errno. Only ENOENT may become missing;
    // every other error must keep the filesystem's own code.
    if (code === "ENOENT") assert.equal(await fs.classify(child), "missing");
    else await assert.rejects(fs.classify(child), { code });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: writeText then readText round-trips, and exists reflects it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const file = path.join(dir, "hello.txt");

    assert.equal(await fs.exists(file), false);
    await fs.writeText(file, "hello");
    assert.equal(await fs.exists(file), true);
    assert.equal(await fs.readText(file), "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: mkdirp creates nested directories and is idempotent", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const nested = path.join(dir, "a", "b", "c");

    await fs.mkdirp(nested);
    assert.equal(await fs.exists(nested), true);
    // Second call must not throw.
    await fs.mkdirp(nested);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: isRegularFile is true only for an ordinary file, not a symlink, directory or missing path", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const file = path.join(dir, "file.txt");
    await fs.writeText(file, "x");
    assert.equal(await fs.isRegularFile(file), true);
    assert.equal(await fs.isRegularFile(dir), false);
    assert.equal(await fs.isRegularFile(path.join(dir, "missing")), false);

    // Creating symlinks needs a privilege on Windows.
    if (process.platform !== "win32") {
      const { symlinkSync } = await import("node:fs");
      symlinkSync(file, path.join(dir, "to-file"));
      symlinkSync(dir, path.join(dir, "to-dir"));
      symlinkSync("nowhere", path.join(dir, "broken"));
      assert.equal(await fs.isRegularFile(path.join(dir, "to-file")), false);
      assert.equal(await fs.isRegularFile(path.join(dir, "to-dir")), false);
      assert.equal(await fs.isRegularFile(path.join(dir, "broken")), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: chmod changes the file mode", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const file = path.join(dir, "script.sh");
    await fs.writeText(file, "#!/bin/sh\n");

    // Windows doesn't observe POSIX mode bits, so only assert this doesn't
    // throw there; assert the effect where it's observable.
    await fs.chmod(file, 0o755);
    if (process.platform !== "win32") {
      const { statSync } = await import("node:fs");
      const mode = statSync(file).mode & 0o777;
      assert.equal(mode, 0o755);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("fs seam: copyNew copies with the file's permissions, and never over an existing file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-fs-seam-"));
  try {
    const fs = createFsSeam();
    const from = path.join(dir, "from");
    const to = path.join(dir, "to");
    writeFileSync(from, "secret", { mode: 0o600 });

    assert.equal(await fs.copyNew(from, to), true);
    assert.equal(readFileSync(to, "utf8"), "secret");
    if (process.platform !== "win32") {
      assert.equal(statSync(to).mode & 0o777, 0o600);
    }

    writeFileSync(to, "mine");
    assert.equal(await fs.copyNew(from, to), false);
    assert.equal(readFileSync(to, "utf8"), "mine");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
