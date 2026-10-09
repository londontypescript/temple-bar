// Filesystem boundary for the content exception. Doubt keeps Knip's finding.
import { constants, promises as fs } from "node:fs";
import path from "node:path";

import { containsOnlyComments } from "./unused-comments.ts";

const EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const MAX_BYTES = 1_048_576;

export async function isCommentOnlyFile(
  root: string,
  file: string,
): Promise<boolean> {
  if (!EXTENSIONS.has(path.extname(file)) || !path.isAbsolute(file))
    return false;
  try {
    const base = await fs.realpath(root);
    const resolved = await fs.realpath(file);
    const relative = path.relative(base, resolved);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return false;
    let lexicalRoot = base;
    let lexical = path.relative(lexicalRoot, file);
    if (
      lexical === ".." ||
      lexical.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexical)
    ) {
      lexicalRoot = path.resolve(root);
      lexical = path.relative(lexicalRoot, file);
    }
    if (
      lexical === ".." ||
      lexical.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexical)
    )
      return false;
    let entry = lexicalRoot;
    for (const part of lexical.split(path.sep)) {
      entry = path.join(entry, part);
      if ((await fs.lstat(entry)).isSymbolicLink()) return false;
    }
    if (!(await fs.lstat(file)).isFile()) return false;
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > MAX_BYTES) return false;
      // Read at most the bound even if another process grows the file.
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_BYTES || bytesRead !== before.size) return false;
      const after = await handle.stat();
      const current = await fs.lstat(file);
      if (
        before.dev !== current.dev ||
        before.ino !== current.ino ||
        !current.isFile() ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        resolved !== (await fs.realpath(file))
      )
        return false;
      return containsOnlyComments(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, bytesRead),
        ),
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
