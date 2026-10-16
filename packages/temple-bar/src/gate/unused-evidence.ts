// Reject incomplete or unfamiliar evidence rather than reinterpret a failure.
import path from "node:path";

const GROUPS = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
  "catalog",
  "catalogReferences",
  "cycles",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The groups the gate asks knip for; every other group must be empty. */
const SELECTED = new Set<string>(["files", "exports", "types"]);

/** One thing knip reported: an unused file, or an unused export or type
 * in a file. */
export interface UnusedFinding {
  readonly group: "files" | "exports" | "types";
  readonly filePath: string;
}

function isSelected(group: string): group is UnusedFinding["group"] {
  return SELECTED.has(group);
}

/** Every finding in complete, familiar evidence; undefined for anything
 * else, or for evidence with no findings at all. */
export function reportedFindings(value: unknown): UnusedFinding[] | undefined {
  if (
    !record(value) ||
    !record(value.report) ||
    !record(value.issues) ||
    !record(value.counters)
  )
    return undefined;
  if (
    value.hasConfigLoadErrors !== false ||
    typeof value.isTreatConfigHintsAsErrors !== "boolean" ||
    typeof value.isTreatTagHintsAsErrors !== "boolean"
  )
    return undefined;
  for (const [count, fatal] of [
    [value.configurationHintCount, value.isTreatConfigHintsAsErrors],
    [value.tagHintCount, value.isTreatTagHintsAsErrors],
  ]) {
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      (fatal === true && count > 0)
    )
      return undefined;
  }
  const expected = new Set<string>(GROUPS);
  if (
    Object.keys(value.report).length !== GROUPS.length ||
    Object.keys(value.issues).length !== GROUPS.length ||
    Object.keys(value.counters).some(
      (key) => !expected.has(key) && key !== "processed" && key !== "total",
    )
  )
    return undefined;
  const findings: UnusedFinding[] = [];
  for (const group of GROUPS) {
    const enabled = value.report[group];
    const issues = value.issues[group];
    const count = value.counters[group];
    if (
      typeof enabled !== "boolean" ||
      !record(issues) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      return undefined;
    let found = 0;
    for (const row of Object.values(issues)) {
      if (!record(row) || Object.keys(row).length === 0) return undefined;
      for (const issue of Object.values(row)) {
        if (
          !record(issue) ||
          issue.type !== group ||
          typeof issue.filePath !== "string" ||
          issue.filePath === "" ||
          // knip names files by absolute path; a relative one would be read
          // against the gate's own folder, not the project's.
          !path.isAbsolute(issue.filePath)
        )
          return undefined;
        found++;
        // A finding in a group the gate didn't ask for is unfamiliar.
        if (!isSelected(group) || !enabled || issue.isFixed === true)
          return undefined;
        findings.push({ group, filePath: issue.filePath });
      }
    }
    if (count !== found) return undefined;
    if (isSelected(group) !== enabled) return undefined;
  }
  return findings.length > 0 ? findings : undefined;
}

/** The unused files, when every finding is an unused file, each listed
 * once; undefined otherwise. Only these can be comment-only. */
export function reportedFilePaths(value: unknown): string[] | undefined {
  const findings = reportedFindings(value);
  if (findings === undefined || findings.some((f) => f.group !== "files"))
    return undefined;
  const paths = findings.map((finding) => finding.filePath);
  return new Set(paths).size === paths.length ? paths : undefined;
}
