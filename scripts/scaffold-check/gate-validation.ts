import { REQUIRED_SCRIPTS } from "../../packages/temple-bar/src/gate/stack.ts";
import { manifest, object } from "./expectation.ts";
import type { RunResult } from "./runner.ts";
import type { Snapshot } from "./snapshot.ts";

// This is the packed gate's report contract, independently enumerated so a
// missing check cannot disappear from scaffold acceptance with its producer.
const BASE_CHECKS = [
  "core setup",
  "gate and title workflows",
  "file-length cap",
  "AGENTS.md size",
  "markdown lint",
  "local links",
  "unused code (knip)",
];
const REMOTE_CHECKS = [
  "branch ruleset",
  "judge ruleset",
  "code scanning rule",
  "gate and title checks rule",
];

export function validateGate(
  snapshot: Snapshot,
  result: RunResult,
  expectedMissing: readonly string[],
): string[] {
  const findings: string[] = [];
  const scripts =
    object(manifest(snapshot.files["package.json"])?.scripts) ?? {};
  const missing = REQUIRED_SCRIPTS.filter(
    (name) => !Object.hasOwn(scripts, name),
  );
  if (JSON.stringify(missing) !== JSON.stringify(expectedMissing))
    findings.push(
      `gate: scaffold script expectation changed: expected ${expectedMissing.join(", ") || "none"}; got ${missing.join(", ") || "none"}`,
    );
  const reported = [
    ...result.output.matchAll(/^gate: .*missing script\(s\): ([^\r\n]+)\r?$/gm),
  ].map((match) => match[1]);
  const expected =
    expectedMissing.length > 0 ? [expectedMissing.join(", ")] : [];
  if (JSON.stringify(reported) !== JSON.stringify(expected))
    findings.push(
      `gate: expected missing script(s): ${expectedMissing.join(", ") || "none"}; got ${JSON.stringify(reported)}`,
    );
  if (result.timedOut || result.code !== (expectedMissing.length > 0 ? 2 : 0))
    findings.push(
      `gate: unexpected exit ${String(result.code)}${result.timedOut ? " (deadline)" : ""}`,
    );

  const lines = result.output.split(/\r?\n/);
  const headers = lines.flatMap((line, index) =>
    line === "gate: checks:" ? [index] : [],
  );
  const verdicts = lines.flatMap((line, index) =>
    /^gate: (?:passed|failed:.*)$/.test(line) ? [index] : [],
  );
  const start = headers[0];
  const end = verdicts[0];
  if (
    headers.length !== 1 ||
    verdicts.length !== 1 ||
    start === undefined ||
    end === undefined ||
    end <= start
  ) {
    findings.push("gate: missing, duplicate or incomplete closing report");
    return findings;
  }
  const names = [...REQUIRED_SCRIPTS, ...BASE_CHECKS, ...REMOTE_CHECKS];
  const rows = lines.slice(start + 1, end);
  if (rows.length !== names.length)
    findings.push(
      `gate: expected ${String(names.length)} check rows; got ${String(rows.length)}`,
    );
  for (const [index, name] of names.entries()) {
    const row = rows[index] ?? "";
    const parsed = /^ {2}(passed|failed|missing|no-op|skipped) +(.+)$/.exec(
      row,
    );
    const label = parsed?.[2] ?? "";
    if (
      parsed === null ||
      !(
        label === name ||
        (label.startsWith(`${name} (`) && label.endsWith(")"))
      )
    ) {
      findings.push(`gate: missing or malformed check row: ${name}: ${row}`);
      continue;
    }
    const status = parsed[1];
    if (REMOTE_CHECKS.includes(name)) {
      // Setup intentionally uses a non-GitHub origin to isolate local
      // compatibility. Only this explicit non-applicability is expected.
      if (status !== "skipped" || label !== `${name} (origin is not on GitHub)`)
        findings.push(`gate: unexpected remote check outcome: ${row.trim()}`);
    } else if (expectedMissing.includes(name)) {
      if (status !== "missing" || label !== `${name} (not in package.json)`)
        findings.push(
          `gate: expected missing check: ${name}; got ${row.trim()}`,
        );
    } else if (status !== "passed") {
      findings.push(`gate: unexpected check outcome: ${row.trim()}`);
    }
  }
  const verdict =
    expectedMissing.length === 0
      ? "gate: passed"
      : `gate: failed: ${expectedMissing.join(", ")}`;
  if (lines[end] !== verdict)
    findings.push(
      `gate: unexpected verdict: ${lines[end] ?? ""}; expected ${verdict}`,
    );
  // Gate diagnostics belong before the report. A second gate diagnostic
  // after it cannot be silently accepted as package-manager chatter.
  if (lines.slice(end + 1).some((line) => line.startsWith("gate:")))
    findings.push("gate: unexpected diagnostic after the closing report");
  return findings;
}
