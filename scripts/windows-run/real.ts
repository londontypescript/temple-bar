// The real machine behind the local side's seams.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { nodeFs } from "./remote/fsx.ts";
import type { Git, LocalDeps } from "./seams.ts";
import { createSsh } from "./ssh.ts";

const START_TOLERANCE_MS = 2_000;

export const git: Git = {
  run: (args, cwd) =>
    new Promise((resolve) => {
      execFile(
        "git",
        [...args],
        { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1;
          resolve({ code, stdout, stderr });
        },
      );
    }),
};

/** A process's start time via ps, to the second. Null when unreadable. */
function startOf(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "lstart=", "-p", String(pid)], (error, stdout) => {
      const ms = error === null ? Date.parse(stdout.trim()) : Number.NaN;
      resolve(Number.isNaN(ms) ? null : ms);
    });
  });
}

export async function createLocalDeps(): Promise<LocalDeps> {
  return {
    cwd: process.cwd(),
    git,
    ssh: createSsh((chunk) => process.stderr.write(chunk)),
    fs: nodeFs,
    stdout: process.stdout,
    stderr: process.stderr,
    makeTempDir: () => mkdtemp(path.join(tmpdir(), "tb-wr-")),
    randomHex: (bytes) => randomBytes(bytes).toString("hex"),
    self: { pid: process.pid, startMs: await startOf(process.pid) },
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    async isAlive(owner) {
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") {
          return false;
        }
      }
      const actual = await startOf(owner.pid);
      if (actual === null || owner.startMs === null) {
        return true;
      }
      return Math.abs(actual - owner.startMs) < START_TOLERANCE_MS;
    },
  };
}
