import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunResult } from "./runner.ts";

export interface GitState {
  readonly config: string;
  readonly hooks: readonly string[];
}

export function gitState(dir: string): GitState {
  return {
    config: readFileSync(path.join(dir, ".git/config")).toString("base64"),
    hooks: readdirSync(path.join(dir, ".git/hooks")).sort(),
  };
}

export function validateRefusal(
  dir: string,
  before: GitState,
  status: RunResult,
  launch: RunResult,
  message: string,
): string[] {
  const findings: string[] = [];
  if (launch.code === 0 || launch.timedOut)
    findings.push("launcher: expected a non-zero refusal without a deadline");
  if (!launch.output.split(/\r?\n/).includes(message))
    findings.push(`launcher: missing its own refusal message: ${message}`);
  if (status.code !== 0 || status.timedOut || status.output !== "")
    findings.push("refusal: git status --porcelain --ignored was not empty");
  try {
    const after = gitState(dir);
    if (after.config !== before.config)
      findings.push("refusal: .git/config changed byte for byte");
    if (JSON.stringify(after.hooks) !== JSON.stringify(before.hooks))
      findings.push("refusal: the set of files in .git/hooks changed");
  } catch {
    findings.push("refusal: .git/config or .git/hooks is missing");
  }
  return findings;
}

/** The packed temple-bar carries the version in this checkout's source,
 * which until a release bump is also the published version. pnpm resolves
 * either one under the same name and version, so only the lockfile's
 * tarball address shows whether the install tested this checkout's code or
 * the package already on npm. */
export function validateSource(
  dir: string,
  registry: string,
  version: string,
): string[] {
  let lockfile: string;
  try {
    lockfile = readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8");
  } catch {
    return ["install: no pnpm-lock.yaml to show where temple-bar came from"];
  }
  const name = escape(TEMPLE_BAR);
  // The project's own entry must use this version, and that version's
  // package entry must resolve to the packed tarball: the address appearing
  // anywhere else in the file proves nothing.
  const imported = new RegExp(
    `^ +'${name}':\\r?\\n +specifier: [^\\r\\n]*\\r?\\n +version: ${escape(version)}\\r?$`,
    "m",
  ).test(lockfile);
  const resolved = new RegExp(
    `^  '${name}@${escape(version)}':\\r?\\n    resolution: \\{[^}\\r\\n]*\\btarball: ${escape(`${registry}tarball.tgz`)}\\}`,
    "m",
  ).test(lockfile);
  return imported && resolved
    ? []
    : [
        `install: temple-bar ${version} didn't come from the packed tarball at ${registry}`,
      ];
}

const TEMPLE_BAR = "@londontypescript/temple-bar";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateCommit(result: RunResult): string[] {
  return result.code !== 0 &&
    !result.timedOut &&
    result.output.includes("refusing to commit directly to main")
    ? []
    : ["hooks: direct commit to main did not refuse with the hook's message"];
}
