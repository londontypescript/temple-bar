// Reject incomplete or unfamiliar evidence rather than reinterpret a failure.
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

export function reportedFilePaths(value: unknown): string[] | undefined {
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
  const paths: string[] = [];
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
          issue.filePath === ""
        )
          return undefined;
        found++;
        // Even unselected findings are retained conservatively.
        if (group !== "files" || !enabled || issue.isFixed === true)
          return undefined;
        paths.push(issue.filePath);
      }
    }
    if (count !== found) return undefined;
    if (
      (group === "files" || group === "exports" || group === "types") !==
      enabled
    )
      return undefined;
  }
  return paths.length > 0 && new Set(paths).size === paths.length
    ? paths
    : undefined;
}
