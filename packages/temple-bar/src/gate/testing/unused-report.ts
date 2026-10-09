// Public reporter evidence for tests; independent of the production validator.
const groups = [
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
];
export function createUnusedReport(): {
  report: Record<string, boolean>;
  issues: Record<
    string,
    Record<string, Record<string, { type: string; filePath: string }>>
  >;
  counters: Record<string, number>;
  hasConfigLoadErrors: boolean;
  configurationHintCount: number;
  tagHintCount: number;
  isTreatConfigHintsAsErrors: boolean;
  isTreatTagHintsAsErrors: boolean;
} {
  return {
    report: Object.fromEntries(
      groups.map((key) => [key, ["files", "exports", "types"].includes(key)]),
    ),
    issues: Object.fromEntries(
      groups.map((key) => [
        key,
        key === "files"
          ? {
              "empty.ts": {
                "empty.ts": { type: "files", filePath: "/repo/empty.ts" },
              },
            }
          : {},
      ]),
    ),
    counters: Object.fromEntries(
      groups.map((key) => [key, key === "files" ? 1 : 0]),
    ),
    hasConfigLoadErrors: false,
    configurationHintCount: 1,
    tagHintCount: 0,
    isTreatConfigHintsAsErrors: false,
    isTreatTagHintsAsErrors: false,
  };
}
