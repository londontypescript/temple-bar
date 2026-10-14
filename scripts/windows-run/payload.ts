// What is sent to Windows, built from the recorded commit and nothing on
// disk: the bundle with that commit's history and the repo's tags (the suite
// checks the release tags, which CI's full-history checkout has), and the
// runner's folder written
// file by file from that commit's tree. A file edited after the commit was
// recorded can't reach the other machine.

import path from "node:path";

import { REMOTE_DIR } from "./paths.ts";
import type { LocalDeps } from "./seams.ts";

export class BundleError extends Error {}

export interface Payload {
  readonly bundle: string;
  /** The folder holding `scripts/windows-run/remote/...`, ready to copy. */
  readonly scriptsDir: string;
}

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

export async function buildPayload(
  deps: LocalDeps,
  sha: string,
  folder: string,
): Promise<Payload> {
  const { git, fs, cwd } = deps;
  const bundle = path.join(folder, "run.bundle");
  const made = await git.run(
    ["bundle", "create", bundle, "HEAD", "--tags"],
    cwd,
  );
  if (made.code !== 0) {
    throw new BundleError("git could not create the bundle");
  }
  const heads = await git.run(["bundle", "list-heads", bundle], cwd);
  const names = heads.stdout
    .split(/\r?\n/)
    .some((line) => line.trim() === `${sha} HEAD`);
  if (heads.code !== 0 || !names) {
    throw new BundleError("the bundle does not hold the recorded commit");
  }

  const listing = await git.run(
    ["ls-tree", "-r", "-z", "--name-only", sha, "--", `${REMOTE_DIR}/`],
    cwd,
  );
  const files = listing.stdout.split("\0").filter((name) => name !== "");
  if (listing.code !== 0 || files.length === 0) {
    throw new BundleError("the runner is not in the recorded commit");
  }
  const payloadRoot = path.join(folder, "payload");
  for (const file of files) {
    if (!SAFE_PATH.test(file) || file.split("/").includes("..")) {
      throw new BundleError("the runner folder holds an unexpected file name");
    }
    const content = await git.run(["show", `${sha}:${file}`], cwd);
    if (content.code !== 0) {
      throw new BundleError("git could not read a runner file");
    }
    const target = path.join(payloadRoot, ...file.split("/"));
    await fs.mkdir(path.dirname(target));
    await fs.writeFile(target, content.stdout);
  }
  return { bundle, scriptsDir: path.join(payloadRoot, "scripts") };
}
