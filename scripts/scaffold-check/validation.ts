import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REQUIRED_SCRIPTS } from "../../packages/temple-bar/src/gate/stack.ts";
import { manifest, object } from "./expectation.ts";
import type { RunResult } from "./runner.ts";
import type { Snapshot } from "./snapshot.ts";

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

export function validateCommit(result: RunResult): string[] {
  return result.code !== 0 &&
    !result.timedOut &&
    result.output.includes("refusing to commit directly to main")
    ? []
    : ["hooks: direct commit to main did not refuse with the hook's message"];
}

export function validateGate(snapshot: Snapshot, result: RunResult): string[] {
  const scripts =
    object(manifest(snapshot.files["package.json"])?.scripts) ?? {};
  const missing = REQUIRED_SCRIPTS.filter(
    (name) => !Object.hasOwn(scripts, name),
  );
  const reported = [
    ...result.output.matchAll(/^gate: .*missing script\(s\): ([^\r\n]+)\r?$/gm),
  ].map((match) => match[1]);
  const expected = missing.length > 0 ? [missing.join(", ")] : [];
  const findings: string[] = [];
  if (JSON.stringify(reported) !== JSON.stringify(expected))
    findings.push(
      `gate: expected missing script(s): ${missing.join(", ") || "none"}; got ${JSON.stringify(reported)}`,
    );
  if (
    result.timedOut ||
    (missing.length > 0 ? result.code !== 2 : ![0, 1].includes(result.code))
  )
    findings.push(
      `gate: unexpected exit ${String(result.code)}${result.timedOut ? " (deadline)" : ""}`,
    );
  return findings;
}
