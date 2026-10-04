// "What you are approving": a short section merge prints before it waits
// for checks, so whoever is asked to approve the merge sees what the code
// diff hides. Three things, each shown even when there is nothing, so "none"
// is a statement rather than a missing line:
//
//   - machinery: changes to what checks this repository (CI workflows, the
//     lint, format and TypeScript config, the scripts the gate runs, the
//     hook install, the pinned temple-bar). A pull request that changes
//     these changes how every later pull request is judged.
//   - dependencies: packages added, removed, or moved to a new major
//     version, from each package.json the pull request touches. Agents are
//     best reviewed by the libraries they pull in.
//   - incidents: how many open issues are labelled incident, which the
//     rules ask for with every merge request.

import path from "node:path";

import { LOCKFILE_NAMES } from "../gate/lengths.ts";
import { REQUIRED_SCRIPTS } from "../gate/stack.ts";
import {
  allDependencies,
  pinnedTempleBar,
  rootManifest,
  stringMap,
  TEMPLE_BAR_PACKAGE,
  type ManifestChange,
  type PullRequestChanges,
} from "./manifests.ts";

/** Files that configure the checks, matched on their repository path. */
const MACHINERY_FILES: readonly (readonly [RegExp, string])[] = [
  [/^\.github\/workflows\//, "a CI workflow"],
  [/^\.github\/actions\//, "an action CI uses"],
  [
    /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?|\.eslintignore)$/,
    "lint config",
  ],
  [
    /(^|\/)(prettier\.config\.[cm]?[jt]s|\.prettierrc(\.[a-z]+)?|\.prettierignore)$/,
    "format config",
  ],
  [/(^|\/)tsconfig[^/]*\.json$/, "TypeScript config"],
  [
    /^temple-bar\.config\.json$/,
    "temple-bar's settings, such as the file-length cap",
  ],
];

/** Root package.json scripts that are part of the checking: the ones the
 * gate runs, the gate itself, and the hook install that runs on every
 * `pnpm install`. */
const MACHINERY_SCRIPTS: ReadonlyMap<string, string> = new Map([
  ...REQUIRED_SCRIPTS.map((name) => [name, "the gate runs it"] as const),
  ["gate", "it runs the gate"],
  ["check", "it runs the gate"],
  ["prepare", "it installs the hooks"],
]);

/** Root package.json fields that can hold lint or format config. */
const CONFIG_FIELDS: ReadonlyMap<string, string> = new Map([
  ["eslintConfig", "lint config"],
  ["prettier", "format config"],
]);

function rootMachinery(root: ManifestChange | undefined): string[] {
  if (root === undefined) {
    return [];
  }
  const found: string[] = [];
  const before = stringMap(root.before, "scripts");
  const after = stringMap(root.after, "scripts");
  for (const [name, why] of MACHINERY_SCRIPTS) {
    if (before.get(name) !== after.get(name)) {
      found.push(`package.json script "${name}" (${why})`);
    }
  }
  for (const [field, what] of CONFIG_FIELDS) {
    if (
      JSON.stringify(root.before?.[field]) !==
      JSON.stringify(root.after?.[field])
    ) {
      found.push(`package.json "${field}" field (${what})`);
    }
  }
  const pinBefore = pinnedTempleBar(root.before);
  const pinAfter = pinnedTempleBar(root.after);
  if (pinBefore !== pinAfter) {
    found.push(
      `the pinned ${TEMPLE_BAR_PACKAGE}, ${pinBefore ?? "none"} -> ${pinAfter ?? "none"} (it judges this repository)`,
    );
  }
  return found;
}

/** Each change to how this repository is checked, in a phrase. */
export function machineryChanges(changes: PullRequestChanges): string[] {
  const found: string[] = [];
  for (const file of changes.files) {
    const match = MACHINERY_FILES.find(([pattern]) => pattern.test(file));
    if (match !== undefined) {
      found.push(`${file} (${match[1]})`);
    }
  }
  return [...found, ...rootMachinery(rootManifest(changes))];
}

/** The part of a version range a breaking change moves, the way `^` reads
 * it: the major version, or for 0.x the first non-zero part, since 0.1 to
 * 0.2 breaks as 1 to 2 does. Undefined when the spec names no version
 * (a tag, a URL, a workspace link). */
export function breakingPart(spec: string): string | undefined {
  // An alias ("npm:name@^1.2.3") carries its range after the last "@".
  const range = spec.slice(spec.lastIndexOf("@") + 1);
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (match === null) {
    return undefined;
  }
  const [, major = "0", minor = "0", patch = "0"] = match;
  if (Number(major) > 0) {
    return major;
  }
  return Number(minor) > 0 ? `0.${minor}` : `0.0.${patch}`;
}

function where(manifest: ManifestChange): string {
  const dir = path.posix.dirname(manifest.path);
  return dir === "." ? "" : ` in ${dir}`;
}

/** Dependencies added, removed or moved to a new major version. */
export function dependencyChanges(changes: PullRequestChanges): string[] {
  const found: string[] = [];
  for (const manifest of changes.manifests) {
    const before = allDependencies(manifest.before);
    const after = allDependencies(manifest.after);
    const place = where(manifest);
    for (const [name, spec] of after) {
      const old = before.get(name);
      if (old === undefined) {
        found.push(`added ${name} ${spec}${place}`);
      } else if (old !== spec) {
        const oldPart = breakingPart(old);
        const newPart = breakingPart(spec);
        // A spec without a version can't be compared, so any change to it
        // is shown rather than guessed at.
        if (oldPart === undefined || newPart === undefined) {
          found.push(`changed ${name} ${old} -> ${spec}${place}`);
        } else if (oldPart !== newPart) {
          found.push(`${name} ${old} -> ${spec}, a new major version${place}`);
        }
      }
    }
    for (const name of before.keys()) {
      if (!after.has(name)) {
        found.push(`removed ${name}${place}`);
      }
    }
  }
  return found;
}

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The section's lines, without the "merge: " prefix. `incidents` is
 * undefined when GitHub couldn't be asked. */
export function approvingSection(
  prNumber: number,
  changes: PullRequestChanges,
  incidents: number | undefined,
): string[] {
  const lines = [`what you are approving in #${String(prNumber)}:`];

  const machinery = machineryChanges(changes);
  lines.push(
    machinery.length === 0
      ? "  machinery: none"
      : `  machinery: ${counted(machinery.length, "change", "changes")} to how this repository is checked`,
    ...machinery.map((entry) => `    ${entry}`),
  );

  const dependencies = dependencyChanges(changes);
  lines.push(
    dependencies.length === 0
      ? "  dependencies: none added, removed or changed in major version"
      : `  dependencies: ${counted(dependencies.length, "change", "changes")}`,
    ...dependencies.map((entry) => `    ${entry}`),
  );
  const lockfiles = changes.files.filter((file) =>
    LOCKFILE_NAMES.has(path.posix.basename(file)),
  );
  if (lockfiles.length > 0) {
    lines.push(
      `    ${lockfiles.join(", ")} changed too; versions within existing ranges and indirect dependencies aren't listed`,
    );
  }

  lines.push(
    incidents === undefined
      ? "  incidents: could not count the open issues labelled incident"
      : `  incidents: ${counted(incidents, "open issue", "open issues")} labelled incident`,
  );
  return lines;
}
