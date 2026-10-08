import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { FOREIGN_LOCKFILES } from "../../packages/create-temple-bar/src/package-manager.ts";
import { COMPANION_FILES } from "../../packages/temple-bar/src/init/companion-docs.ts";
import type { ScaffoldFixture } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";

export interface Snapshot {
  readonly files: Readonly<Record<string, string>>;
  /** Base64 strings retain bytes, including binary lockfiles, without mutable Buffers. */
  readonly bytes: Readonly<Record<string, string>>;
  readonly symlinks: Readonly<Record<string, string>>;
  readonly directories: readonly string[];
  readonly rootEntries: readonly string[];
}

const READ_PATHS = new Set([
  "package.json",
  "AGENTS.md",
  "CLAUDE.md",
  ".gitignore",
  ".npmrc",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ...FOREIGN_LOCKFILES,
  ...COMPANION_FILES.map((file) => file.path),
]);
const CONFIG =
  /^(?:eslint\.config\.|\.eslintrc(?:\.|$)|\.eslintignore$|\.oxlintrc(?:\.|$)|oxlint\.config\.|\.prettierrc(?:\.|$)|prettier\.config\.|\.prettierignore$|\.editorconfig$|biome\.jsonc?$)/;

export function capture(project: string): Snapshot {
  const files: Record<string, string> = {};
  const bytes: Record<string, string> = {};
  const symlinks: Record<string, string> = {};
  const directories: string[] = [];
  const roots = readdirSync(project).sort();
  const visit = (relative: string, all: boolean) => {
    const full = path.join(project, relative);
    const stat = lstatSync(full);
    const selected =
      all ||
      READ_PATHS.has(relative) ||
      (!relative.includes("/") && CONFIG.test(relative));
    if (stat.isSymbolicLink()) {
      if (selected || !relative.includes("/"))
        symlinks[relative] = readlinkSync(full);
    } else if (stat.isDirectory()) {
      directories.push(relative);
      if (
        all ||
        relative === ".github" ||
        [...READ_PATHS].some((file) => file.startsWith(`${relative}/`))
      ) {
        for (const name of readdirSync(full).sort())
          visit(`${relative}/${name}`, all || relative === ".github");
      }
    } else if (stat.isFile() && selected) {
      const content = readFileSync(full);
      bytes[relative] = content.toString("base64");
      files[relative] = content.toString("utf8");
    }
  };
  for (const name of roots) visit(name, false);
  return Object.freeze({
    files: Object.freeze(files),
    bytes: Object.freeze(bytes),
    symlinks: Object.freeze(symlinks),
    directories: Object.freeze(directories),
    rootEntries: Object.freeze(roots),
  });
}

export interface Comparison {
  readonly differences: readonly string[];
  readonly information: readonly string[];
}

function differingLine(before: string, after: string): string {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const oldLines = lines(before);
  const newLines = lines(after);
  let index = 0;
  while (
    index < Math.max(oldLines.length, newLines.length) &&
    oldLines[index] === newLines[index]
  )
    index++;
  const show = (line: string | undefined) =>
    line === undefined
      ? "<EOF>"
      : `${JSON.stringify(line)}${line.endsWith("\n") ? "" : " (no final newline)"}`;
  return `line ${String(index + 1)}: ${show(oldLines[index])} -> ${show(newLines[index])}`;
}

export function compare(
  snapshot: Snapshot,
  fixture: ScaffoldFixture,
  version: string,
): Comparison {
  const differences: string[] = [];
  for (const name of [
    ...new Set([...Object.keys(fixture.files), ...Object.keys(snapshot.files)]),
  ].sort()) {
    const before = fixture.files[name];
    const after = snapshot.files[name];
    if (before === undefined) differences.push(`file added: ${name}`);
    else if (after === undefined) differences.push(`file removed: ${name}`);
    else if (Buffer.from(before).toString("base64") !== snapshot.bytes[name])
      differences.push(
        `file changed: ${name}, ${differingLine(before, after)}`,
      );
  }
  for (const name of [
    ...new Set([
      ...Object.keys(fixture.symlinks),
      ...Object.keys(snapshot.symlinks),
    ]),
  ].sort()) {
    const before = fixture.symlinks[name];
    const after = snapshot.symlinks[name];
    if (before === undefined)
      differences.push(`link added: ${name} -> ${JSON.stringify(after)}`);
    else if (after === undefined) differences.push(`link removed: ${name}`);
    else if (before !== after)
      differences.push(
        `link retargeted: ${name}, ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      );
  }
  const recorded = fixture.rootEntries ?? [];
  for (const name of snapshot.rootEntries)
    if (!recorded.includes(name)) differences.push(`root entry added: ${name}`);
  for (const name of recorded)
    if (!snapshot.rootEntries.includes(name))
      differences.push(`root entry removed: ${name}`);
  return {
    differences,
    information:
      version === fixture.version
        ? []
        : [`version moved: ${fixture.version} -> ${version}`],
  };
}
