// What makes a catalog change inert: facts about the head beyond the
// workspace file itself. A catalog entry reaches a package only through a
// `catalog:` reference in a manifest's own dependencies, which are the
// project's, never temple-bar's. Two things could map it onto temple-bar's
// install anyway: an override that reads the catalog, and code that runs at
// install (a pnpmfile, an .npmrc, a config dependency). A root name that
// only folds to the workspace file or the root manifest is the file a
// case-insensitive checkout reads instead. Any of these, or a fact nobody
// could establish, turns the exception off. See "What makes a catalog
// change inert" in docs/adr/0015-every-package-checked-and-guarded.md.
//
// Both readers gather the facts from one listing of the head's tree, here,
// so they can't gather them differently.

import type { CatalogContext, FileState } from "./file-state.ts";
import {
  foldedName,
  isNpmrc,
  isPnpmfile,
  WORKSPACE_FILE,
} from "./guarded-paths.ts";
import { parseManifest, type Manifest } from "./manifests.ts";
import type { TreeEntry } from "./tree-entry.ts";

const ROOT_MANIFEST = "package.json";

/** The facts a tree listing gives, and the one entry left to read. */
export interface HeadFacts extends Omit<CatalogContext, "rootManifest"> {
  /** The head's root package.json, for the reader to read by its id. */
  readonly rootManifest: TreeEntry | undefined;
}

/** A root entry that folds to `name` without being exactly it. */
const isTwinOf = (file: string, name: string): boolean =>
  !file.includes("/") && file !== name && foldedName(file) === name;

/** The facts in the head's whole tree (path to entry, folders included),
 * each list sorted. Entries of every kind count: a folder named .npmrc is
 * as much an .npmrc to this rule as a file. */
export function headFacts(tree: ReadonlyMap<string, TreeEntry>): HeadFacts {
  const files = [...tree.keys()].sort();
  return {
    rootManifest: tree.get(ROOT_MANIFEST),
    foldedTwins: files.filter(
      (file) => isTwinOf(file, WORKSPACE_FILE) || isTwinOf(file, ROOT_MANIFEST),
    ),
    pnpmfiles: files.filter(isPnpmfile),
    npmrcs: files.filter(isNpmrc),
  };
}

function isRecord(value: unknown): value is Manifest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Where a string sits, as the keys leading to it. */
type Found = readonly [path: readonly (string | number)[], value: string];

/** Every string at any depth, arrays included, with where it sits. */
function* strings(
  value: unknown,
  path: readonly (string | number)[],
): Generator<Found> {
  if (typeof value === "string") {
    yield [path, value];
  } else if (Array.isArray(value)) {
    for (const [index, item] of (value as unknown[]).entries()) {
      yield* strings(item, [...path, index]);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      yield* strings(item, [...path, key]);
    }
  }
}

const label = (path: readonly (string | number)[]): string =>
  path.map((part) => JSON.stringify(part)).join(" > ");

/** pnpm resolves `catalog:` inside an override's value, and `$name` makes
 * an override follow the root manifest's own spec, which may be
 * `catalog:`. Either reaches every package's dependencies, temple-bar's
 * included. Case aside, at any depth, under every field pnpm takes
 * overrides from. */
function overrideProblem(manifest: Manifest): string | undefined {
  for (const field of ["overrides", "resolutions", "pnpm"]) {
    const value = Object.hasOwn(manifest, field) ? manifest[field] : undefined;
    for (const [path, text] of strings(value, [field])) {
      if (text.toLowerCase().includes("catalog:") || text.startsWith("$")) {
        return `an override reads the catalog: ${label(path)} in package.json here is ${JSON.stringify(text)}`;
      }
    }
  }
  return undefined;
}

/** pnpm loads code from a config dependency named as a plugin, and reads
 * config dependencies from the root manifest's `pnpm` field. Any of them
 * counts, whatever its name, since pnpm's naming rule may change. */
function configDependencyProblem(manifest: Manifest): string | undefined {
  const pnpm = Object.hasOwn(manifest, "pnpm") ? manifest.pnpm : undefined;
  const key = isRecord(pnpm)
    ? Object.keys(pnpm).find(
        (name) => name.toLowerCase() === "configdependencies",
      )
    : undefined;
  return key === undefined
    ? undefined
    : `code runs at install: package.json's "pnpm" field here sets ${JSON.stringify(key)}`;
}

/** The head's root manifest must be a regular, valid manifest with no
 * override that reads the catalog: absent, unreadable or invalid is
 * unknown, and unknown is never inert. */
function rootManifestProblem(state: FileState): string | undefined {
  if (state.kind === "absent") {
    return "unknown: there is no root package.json here";
  }
  if (state.kind === "special") {
    return "unknown: the root package.json here isn't a regular file";
  }
  if (state.kind === "unreadable") {
    return `unknown: could not read the root package.json here: ${state.reason}`;
  }
  if (state.text === undefined) {
    return "unknown: the root package.json here wasn't read";
  }
  const parsed = parseManifest(state.text);
  if (parsed.kind === "invalid") {
    return `unknown: the root package.json here ${parsed.why}`;
  }
  return overrideProblem(parsed.value) ?? configDependencyProblem(parsed.value);
}

const first = (paths: readonly string[]): string | undefined =>
  [...paths].sort()[0];

/** The first fact that lets a catalog change reach temple-bar's install,
 * or undefined when the change is inert. No facts at all is unknown. */
export function inertProblem(
  context: CatalogContext | undefined,
): string | undefined {
  if (context === undefined) {
    return "unknown: the facts about the head that make a catalog change inert weren't read";
  }
  const twin = first(context.foldedTwins);
  if (twin !== undefined) {
    return `folded name: ${twin} here folds to ${foldedName(twin)}`;
  }
  const manifest = rootManifestProblem(context.rootManifest);
  if (manifest !== undefined) {
    return manifest;
  }
  const pnpmfile = first(context.pnpmfiles);
  if (pnpmfile !== undefined) {
    return `code runs at install: a pnpmfile here (${pnpmfile})`;
  }
  const npmrc = first(context.npmrcs);
  return npmrc === undefined
    ? undefined
    : `code runs at install: an .npmrc here (${npmrc})`;
}
