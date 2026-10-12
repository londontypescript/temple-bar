// The local half of `pnpm windows-run`: check the local conditions, take the
// lock, build what is sent from the recorded commit, send it, run the runner,
// and decide from what came back how the run ended.
//
// Exit codes: 0 every step passed; 1 a step failed or Windows refused the run;
// 2 refused here before contacting anything; 3 incomplete (no valid result).

import path from "node:path";

import {
  findPrimary,
  isValidHost,
  readSavedHost,
  saveHost,
  SET_HOST_COMMAND,
} from "./host.ts";
import { runnerCommand, stagingForCmd, stagingForScp } from "./paths.ts";
import { BundleError, buildPayload } from "./payload.ts";
import { LineBuffer } from "./remote/lines.ts";
import { removeWithRetry } from "./remote/fsx.ts";
import { acquireLock, releaseLock, type LockDeps } from "./remote/lock.ts";
import { RUN_ID_PATTERN, SHA_PATTERN } from "./remote/record.ts";
import type { LocalDeps } from "./seams.ts";
import { summarize, type LocalRefusal, type SummaryInput } from "./summary.ts";
import { judge } from "./verdict.ts";

const USAGE = "Usage: pnpm windows-run [--host <ssh-destination>]";

type ParsedArgs =
  | { readonly ok: true; readonly host: string | undefined }
  | { readonly ok: false };

function parseArgs(args: readonly string[]): ParsedArgs {
  if (args.length === 0) {
    return { ok: true, host: undefined };
  }
  const [flag, value, ...rest] = args;
  if (flag !== "--host" || value === undefined || rest.length > 0) {
    return { ok: false };
  }
  return { ok: true, host: value };
}

/** A refusal before anything is contacted: `detail` is for the terminal, the
 * summary only gets the fixed reason. */
function refuse(deps: LocalDeps, reason: LocalRefusal, detail: string): number {
  deps.stderr.write(`windows-run: ${detail}\n`);
  deps.stdout.write(`${summarize({ kind: "refused", reason })}\n`);
  return 2;
}

function finishWith(
  deps: LocalDeps,
  input: SummaryInput,
  code: number,
): number {
  deps.stdout.write(`\n${summarize(input)}\n`);
  return code;
}

async function resolveHost(
  deps: LocalDeps,
  primary: string,
  given: string | undefined,
): Promise<{ host: string } | { code: number }> {
  const saved = await readSavedHost(deps.fs, primary);
  if (given !== undefined) {
    return { host: given };
  }
  if (saved.kind === "host") {
    return { host: saved.host };
  }
  if (saved.kind === "bad") {
    return {
      code: refuse(
        deps,
        "bad-host",
        `the saved SSH destination in ${path.join(primary, ".temple-bar", "windows-run.json")} is not usable (${saved.why}). Set it again with:\n  ${SET_HOST_COMMAND}`,
      ),
    };
  }
  return {
    code: refuse(
      deps,
      "no-host",
      `no Windows machine is saved. Ask the maintainer for its SSH destination, then run:\n  ${SET_HOST_COMMAND}`,
    ),
  };
}

export async function runLocal(
  args: readonly string[],
  deps: LocalDeps,
): Promise<number> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    deps.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (parsed.host !== undefined && !isValidHost(parsed.host)) {
    return refuse(
      deps,
      "bad-host",
      "the SSH destination must be an alias or hostname, optionally with user@, using only letters, digits, dots, underscores and hyphens (a port belongs in ~/.ssh/config)",
    );
  }

  const listing = await deps.git.run(
    ["worktree", "list", "--porcelain"],
    deps.cwd,
  );
  const primary = await findPrimary(listing, deps.fs);
  if (!primary.ok) {
    return refuse(deps, "not-a-checkout", primary.reason);
  }
  const resolved = await resolveHost(deps, primary.dir, parsed.host);
  if ("code" in resolved) {
    return resolved.code;
  }
  const { host } = resolved;

  const status = await deps.git.run(["status", "--porcelain"], deps.cwd);
  if (status.code !== 0 || status.stdout.trim() !== "") {
    return refuse(
      deps,
      status.code !== 0 ? "not-a-checkout" : "dirty-tree",
      "the tree is not clean. The run is of committed work only: commit or remove changes and untracked files first",
    );
  }
  const head = await deps.git.run(["rev-parse", "HEAD"], deps.cwd);
  const sha = head.stdout.trim();
  if (head.code !== 0 || !SHA_PATTERN.test(sha)) {
    return refuse(deps, "not-a-checkout", "HEAD is not a commit");
  }
  const runId = deps.randomHex(4);
  if (!RUN_ID_PATTERN.test(runId)) {
    return refuse(deps, "not-a-checkout", "could not make a run id");
  }

  // Taken before anything is copied, and released whatever happens.
  const lockDir = path.join(primary.dir, ".temple-bar", "windows-run.lock");
  const lockDeps: LockDeps = {
    fs: deps.fs,
    sleep: (ms) => deps.sleep(ms),
    isAlive: (owner) => deps.isAlive(owner),
  };
  await deps.fs.mkdir(path.dirname(lockDir));
  const lock = await acquireLock(lockDeps, lockDir, {
    pid: deps.self.pid,
    startMs: deps.self.startMs,
    runId,
  });
  if (lock.kind === "held") {
    return refuse(
      deps,
      "local-lock-held",
      `another run is in progress from this checkout. If it is not, delete ${lockDir}`,
    );
  }
  try {
    if (lock.tookOver !== undefined) {
      deps.stderr.write(`windows-run: took over ${lock.tookOver}\n`);
    }
    return await sendAndRun(deps, host, sha, runId, () =>
      parsed.host === undefined
        ? Promise.resolve()
        : saveHost(deps.fs, primary.dir, parsed.host, runId),
    );
  } finally {
    await releaseLock(lockDeps, lockDir, runId).catch(() => {
      deps.stderr.write(`windows-run: could not release ${lockDir}\n`);
    });
  }
}

async function sendAndRun(
  deps: LocalDeps,
  host: string,
  sha: string,
  runId: string,
  saveChosenHost: () => Promise<void>,
): Promise<number> {
  const folder = await deps.makeTempDir();
  try {
    let payload;
    try {
      payload = await buildPayload(deps, sha, folder);
    } catch (error) {
      if (error instanceof BundleError) {
        return refuse(deps, "bundle-failed", error.message);
      }
      throw error;
    }

    const incomplete = (why: "unreachable" | "connection" | "no-result") =>
      finishWith(deps, { kind: "incomplete", sha, why }, 3);
    const unreachable = (step: string): number => {
      deps.stderr.write(
        `windows-run: ${step} failed. The saved machine (${host}) may be asleep or unreachable; nothing was switched to another host.\n`,
      );
      return incomplete("unreachable");
    };

    // Saved only now: every local refusal, the bundle's included, has passed.
    await saveChosenHost();
    deps.stderr.write(`windows-run: running ${sha.slice(0, 7)} on ${host}\n`);
    const staged = await deps.ssh.exec(
      host,
      ["mkdir", stagingForCmd(runId)],
      () => undefined,
      (chunk) => {
        deps.stderr.write(chunk.toString("utf8"));
      },
    );
    if (staged !== 0) {
      return unreachable("preparing the staging folder");
    }
    const dest = `${stagingForScp(runId)}/`;
    if ((await deps.ssh.copy(host, payload.bundle, dest, false)) !== 0) {
      return unreachable("copying the bundle");
    }
    if ((await deps.ssh.copy(host, payload.scriptsDir, dest, true)) !== 0) {
      return unreachable("copying the runner");
    }

    const lines: string[] = [];
    const buffer = new LineBuffer();
    const sshExit = await deps.ssh.exec(
      host,
      runnerCommand(runId, sha),
      (chunk) => {
        deps.stdout.write(chunk.toString("utf8"));
        lines.push(...buffer.push(chunk));
      },
      (chunk) => {
        deps.stderr.write(chunk.toString("utf8"));
      },
    );
    lines.push(...buffer.end());

    const verdict = judge(lines, runId, sha, sshExit);
    if (verdict.code === 3) {
      deps.stderr.write(
        verdict.reason === "connection"
          ? `windows-run: the connection ended with ssh exit ${String(sshExit)} before the run was known to be finished\n`
          : "windows-run: no valid result record came back\n",
      );
      return incomplete(verdict.reason);
    }
    return finishWith(
      deps,
      { kind: "result", record: verdict.record },
      verdict.code,
    );
  } finally {
    await removeWithRetry(deps.fs, (ms) => deps.sleep(ms), folder).catch(() => {
      deps.stderr.write("windows-run: could not remove the temp folder\n");
    });
  }
}
