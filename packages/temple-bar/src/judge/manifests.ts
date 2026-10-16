// What a change to one package.json does to the checks. Every script of
// every package counts, since a guarded script can hand its work to an
// unguarded one (`test` calling `test:unit`), and install-time scripts such
// as `postinstall` run during CI's install, before any check. Comparing the
// whole map needs no reading of shell commands. A package added with
// scripts, or removed, changes which checks run at all. See
// docs/adr/0015-every-package-checked-and-guarded.md.

import {
  modeFindings,
  textOf,
  unreadableFindings,
  type FileState,
} from "./file-state.ts";
import { isRootManifest } from "./guarded-paths.ts";

export const TEMPLE_BAR_PACKAGE = "@londontypescript/temple-bar";

export type Manifest = Readonly<Record<string, unknown>>;

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

/** Fields that choose the package manager and the runtime. pnpm honours a
 * package's own devEngines when it runs that package's scripts, so these
 * count in every package.json. */
const PACKAGE_MANAGER_FIELDS = ["packageManager", "devEngines"] as const;

/** pnpm reads its own settings (overrides, patches, allowed build scripts)
 * from the root package.json only. */
const ROOT_FIELDS = ["pnpm"] as const;

export type ParsedManifest =
  | {
      readonly kind: "valid";
      readonly value: Manifest;
      readonly scripts: ReadonlyMap<string, unknown>;
    }
  | { readonly kind: "invalid"; readonly why: string };

type ValidManifest = Extract<ParsedManifest, { kind: "valid" }>;

const NOTHING: ValidManifest = { kind: "valid", value: {}, scripts: new Map() };

function isRecord(value: unknown): value is Manifest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field the manifest sets itself. JSON.parse gives plain objects, so a
 * plain lookup of "constructor" would find Object's own. */
function own(record: Manifest, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** package.json's text as valid, or invalid with why. A `scripts` that is
 * there but isn't an object makes it invalid: pnpm can't run scripts from
 * it, and nothing in it can be compared. */
export function parseManifest(text: string): ParsedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", why: "isn't valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { kind: "invalid", why: "isn't a JSON object" };
  }
  const scripts = own(parsed, "scripts");
  if (scripts !== undefined && !isRecord(scripts)) {
    return { kind: "invalid", why: `has a "scripts" that isn't an object` };
  }
  return {
    kind: "valid",
    value: parsed,
    scripts: new Map(Object.entries(scripts ?? {})),
  };
}

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

/** Every place a manifest sets temple-bar's version, by a readable label.
 * Override keys can carry a version range (`pkg@1`) or a parent
 * (`a>@londontypescript/temple-bar`), so any key naming the package counts. */
function pinEntries(manifest: Manifest): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  const fields: [string, unknown][] = VERSION_FIELDS.map((name) => [
    name,
    own(manifest, name),
  ]);
  const pnpm = own(manifest, "pnpm");
  fields.push([
    "pnpm.overrides",
    isRecord(pnpm) ? own(pnpm, "overrides") : undefined,
  ]);
  for (const [name, field] of fields) {
    for (const [key, value] of Object.entries(isRecord(field) ? field : {})) {
      if (key.includes(TEMPLE_BAR_PACKAGE)) {
        entries.set(`${name}["${key}"]`, value);
      }
    }
  }
  return entries;
}

function pinFindings(file: string, before: Manifest, after: Manifest) {
  const pinsBefore = pinEntries(before);
  const pinsAfter = pinEntries(after);
  const findings: string[] = [];
  for (const label of new Set([...pinsBefore.keys(), ...pinsAfter.keys()])) {
    const was = show(pinsBefore.get(label));
    const now = show(pinsAfter.get(label));
    if (was !== now) {
      findings.push(
        `${file}: the temple-bar version in ${label} (${was} on the base branch, ${now} here)`,
      );
    }
  }
  return findings;
}

function fieldFindings(file: string, before: Manifest, after: Manifest) {
  const fields = isRootManifest(file)
    ? [...PACKAGE_MANAGER_FIELDS, ...ROOT_FIELDS]
    : PACKAGE_MANAGER_FIELDS;
  return fields
    .filter((name) => show(own(before, name)) !== show(own(after, name)))
    .map((name) => `${file}: the "${name}" field`);
}

/** Each script added, removed or changed, by exact JSON value. A value
 * that isn't a string always counts: pnpm has no meaning for it to keep. */
function scriptFindings(
  file: string,
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): string[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names
    .filter((name) => {
      const now = after.get(name);
      return typeof now !== "string" || show(before.get(name)) !== show(now);
    })
    .map((name) => `${file}: the "${name}" script`);
}

/**
 * The findings for one changed package.json, in a stable order: what
 * happened to the file, then temple-bar's version, the package-manager
 * fields and the scripts. A manifest that is invalid on the base branch is
 * nothing to compare against, so each of the head's scripts counts; one
 * invalid here is a finding of its own.
 */
export function manifestFindings(
  file: string,
  base: FileState,
  head: FileState,
): string[] {
  if (base.kind === "unreadable" || head.kind === "unreadable") {
    return unreadableFindings(file, base, head);
  }
  if (head.kind === "absent") {
    return base.kind === "absent" ? [] : [`${file} (removed)`];
  }
  const findings = modeFindings(file, base, head);
  if (head.kind === "special") {
    return findings;
  }
  const now = parseManifest(textOf(file, head));
  if (now.kind === "invalid") {
    return [
      ...findings,
      `${file} ${now.why} here, so the judge can't tell whether it changes the checks`,
    ];
  }
  const was =
    base.kind === "regular" ? parseManifest(textOf(file, base)) : NOTHING;
  const before = was.kind === "valid" ? was : NOTHING;
  if (base.kind === "absent" && now.scripts.size > 0) {
    findings.push(`${file} (added, with scripts)`);
  }
  findings.push(
    ...pinFindings(file, before.value, now.value),
    ...fieldFindings(file, before.value, now.value),
  );
  // An added manifest's scripts are its one "added, with scripts" line.
  if (base.kind !== "absent") {
    findings.push(...scriptFindings(file, before.scripts, now.scripts));
  }
  return findings;
}
