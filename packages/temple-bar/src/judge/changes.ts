// What the judge looks for in a pull request: changes to the files that
// decide whether and how its checks run. A pull request's own CI runs the
// workflow files and scripts from the pull request itself, so a pull request
// that weakens them could go green on its own say-so. These are the changes
// that can't be judged by the checks they change. See
// docs/adr/0011-which-checks-judge-a-pull-request.md.
//
// Pure: it is handed the changed files and both copies of package.json, and
// never reads GitHub or the disk itself. The judge hands it what GitHub
// lists; `ready` and `merge` hand it what git shows, so all three agree on
// which changes only the maintainer can let through.

import { REQUIRED_SCRIPTS } from "../gate/stack.ts";

export const TEMPLE_BAR_PACKAGE = "@londontypescript/temple-bar";

/** Every file under here is a workflow GitHub runs. A pull request runs its
 * own copy of them, so editing one changes the checks that judge it. */
export const WORKFLOWS_FOLDER = ".github/workflows/";

/** CI runs `pnpm gate`, and the gate runs the four scripts it requires, so
 * changing any of these changes what the checks do. */
export const GUARDED_SCRIPTS: readonly string[] = ["gate", ...REQUIRED_SCRIPTS];

/** What to do about a change the judge refuses, said the same way wherever
 * temple-bar refuses one. The maintainer lets it through with the bypass
 * the judge's ruleset gives the repository admin role. Only the maintainer
 * runs that merge; temple-bar never does, and never names how. */
export const ASK_FOR_ADMIN_MERGE =
  "Ask the maintainer to review the pull request and, if they agree, to " +
  "merge it themselves as a repository admin.";

/** Where a dependency's version can be set in package.json. The overrides
 * fields matter as much as the dependency lists: an override can swap the
 * pinned temple-bar for any other version, or for a local folder. */
const VERSION_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
] as const;

/** One changed file, as GitHub's pull request files API lists it. */
export interface ChangedFile {
  readonly filename: string;
  readonly status: string;
  /** Set for a rename: the path the file had before. */
  readonly previousFilename?: string;
}

/** package.json as text on each side, or undefined where there is none. */
export interface ManifestPair {
  readonly base: string | undefined;
  readonly head: string | undefined;
}

type Manifest = Readonly<Record<string, unknown>>;

/** package.json already parsed on each side: undefined where there is none,
 * or where it isn't a JSON object. */
export interface ParsedManifestPair {
  readonly before: Manifest | undefined;
  readonly after: Manifest | undefined;
}

function touches(file: ChangedFile, predicate: (path: string) => boolean) {
  return (
    predicate(file.filename) ||
    (file.previousFilename !== undefined && predicate(file.previousFilename))
  );
}

const isWorkflow = (path: string): boolean => path.startsWith(WORKFLOWS_FOLDER);

/** Only the root package.json: it is the one whose scripts CI runs and whose
 * dependencies install temple-bar. */
const isRootManifest = (path: string): boolean => path === "package.json";

/** Whether the pull request changes the root package.json at all, so the
 * caller knows whether both copies need reading. */
export function changesManifest(files: readonly ChangedFile[]): boolean {
  return files.some((file) => touches(file, isRootManifest));
}

type ParsedManifest =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly value: Manifest };

function isRecord(value: unknown): value is Manifest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(text: string | undefined): ParsedManifest {
  if (text === undefined) {
    return { kind: "absent" };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed)
      ? { kind: "ok", value: parsed }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function field(manifest: Manifest | undefined, name: string): Manifest {
  const value = manifest?.[name];
  return isRecord(value) ? value : {};
}

/** Every place package.json sets temple-bar's version, by a readable label.
 * Override keys can carry a version range (`pkg@1`) or a parent
 * (`a>@londontypescript/temple-bar`), so any key naming the package counts. */
function pinEntries(manifest: Manifest | undefined): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const name of VERSION_FIELDS) {
    for (const [key, value] of Object.entries(field(manifest, name))) {
      if (key.includes(TEMPLE_BAR_PACKAGE)) {
        entries.set(`${name}["${key}"]`, value);
      }
    }
  }
  for (const [key, value] of Object.entries(
    field(field(manifest, "pnpm"), "overrides"),
  )) {
    if (key.includes(TEMPLE_BAR_PACKAGE)) {
      entries.set(`pnpm.overrides["${key}"]`, value);
    }
  }
  return entries;
}

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function manifestFindings(pair: ManifestPair): string[] {
  const base = parseManifest(pair.base);
  const head = parseManifest(pair.head);
  if (head.kind === "invalid") {
    // Unreadable means unknown, and an unknown change to the checks is
    // treated as one: the judge fails closed.
    return [
      "package.json isn't valid JSON here, so the judge can't tell whether it changes the checks",
    ];
  }
  return parsedManifestFindings({
    before: base.kind === "ok" ? base.value : undefined,
    after: head.kind === "ok" ? head.value : undefined,
  });
}

function parsedManifestFindings({
  before,
  after,
}: ParsedManifestPair): string[] {
  const findings: string[] = [];

  const pinsBefore = pinEntries(before);
  const pinsAfter = pinEntries(after);
  for (const label of new Set([...pinsBefore.keys(), ...pinsAfter.keys()])) {
    const was = pinsBefore.get(label);
    const now = pinsAfter.get(label);
    if (show(was) !== show(now)) {
      findings.push(
        `package.json: the temple-bar version in ${label} (${show(was)} on the base branch, ${show(now)} here)`,
      );
    }
  }

  const scriptsBefore = field(before, "scripts");
  const scriptsAfter = field(after, "scripts");
  for (const name of GUARDED_SCRIPTS) {
    if (show(scriptsBefore[name]) !== show(scriptsAfter[name])) {
      findings.push(`package.json: the "${name}" script`);
    }
  }
  return findings;
}

function workflowFindings(files: readonly ChangedFile[]): string[] {
  const findings: string[] = [];
  for (const file of files) {
    if (touches(file, isWorkflow)) {
      const renamed =
        file.previousFilename === undefined
          ? ""
          : ` from ${file.previousFilename}`;
      findings.push(`${file.filename} (${file.status}${renamed})`);
    }
  }
  return findings;
}

/**
 * Every change to the checks, one line each, in a stable order: workflows
 * first, then package.json. Empty when the pull request leaves them alone.
 * `manifests` is needed only when changesManifest(files) is true.
 */
export function findCheckChanges(
  files: readonly ChangedFile[],
  manifests?: ManifestPair,
): string[] {
  const findings = workflowFindings(files);
  if (changesManifest(files)) {
    if (manifests === undefined) {
      throw new Error("findCheckChanges: package.json changed but not read");
    }
    findings.push(...manifestFindings(manifests));
  }
  return findings;
}

/**
 * The same findings from a local diff: the paths git lists, and the root
 * package.json already parsed when it changed. git's `--no-renames` list
 * names both sides of a rename, so nothing moves a workflow out of sight.
 */
export function findCheckChangesInDiff(
  paths: readonly string[],
  rootManifest: ParsedManifestPair | undefined,
): string[] {
  const files = paths.map((filename) => ({ filename, status: "changed" }));
  const findings = workflowFindings(files);
  if (changesManifest(files)) {
    findings.push(
      ...parsedManifestFindings(
        rootManifest ?? { before: undefined, after: undefined },
      ),
    );
  }
  return findings;
}
