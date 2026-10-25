// The coverage check's TypeScript listings: which files a typecheck
// script's `tsc` commands check, asked of the same tsc the script runs.
//
// `tsc -p <config> --listFilesOnly` prints every file of the program, one
// absolute path per line, through links and in the disk's own letter
// case, library and node_modules declarations included, and checks and
// writes nothing. TypeScript allows neither it nor `--showConfig` with
// `--build`, so `tsc -b` is listed project by project: `--showConfig`
// gives each config's references (it reads tsconfig's comments and
// trailing commas, so the gate never parses a tsconfig itself), and every
// config they reach is listed with `--listFilesOnly`.
//
// The script's own flags are left out of every call: none of those it may
// use changes the file list, and tsc -p refuses the build-mode ones.
//
// Stated limit: a file list proves a file is included, not that checking
// is strict: `noCheck` could still switch it off. See
// docs/adr/0016-agent-rules-and-the-merge-loop.md.

import path from "node:path";

import {
  firstLine,
  type Listing,
  type ListingContext,
  type ToolOutput,
} from "./coverage-listing.ts";
import type { TypecheckPart } from "./coverage-scripts.ts";

/** A line of tsc's that names a compiler error, which a listing with an
 * absolute path in it can still be. */
const TS_ERROR = /\berror TS\d+\b/;

/** The files and the other lines `--listFilesOnly` printed. tsc prints
 * its diagnostics on stdout, among the files: any line that isn't an
 * absolute path is one. */
export function readListedFiles(
  stdout: string,
  platform: NodeJS.Platform,
): { readonly paths: string[]; readonly diagnostics: string[] } {
  const paths: string[] = [];
  const diagnostics: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const absolute =
      line.startsWith("/") ||
      (platform === "win32" && /^[A-Za-z]:[\\/]/.test(line));
    (absolute && !TS_ERROR.test(line) ? paths : diagnostics).push(line);
  }
  return { paths, diagnostics };
}

/** A line pnpm or npm tags as its own error. */
const MANAGER_ERROR = /\bERR_/;

/** Why a call failed, said in one line: tsc's first error. Else, when it
 * exited non-zero: the package manager's own error, on either stream (a
 * pnpm that can't find the tool prints it on stdout, after a bare
 * `undefined`, while its warnings go to stderr); else stderr's first line;
 * else the first line on stdout that says something. Else, the first line
 * that isn't a file. */
function failureOf(
  output: ToolOutput,
  diagnostics: readonly string[],
): string | undefined {
  if (output.code === 0 && diagnostics.length === 0) {
    return undefined;
  }
  const tsError = diagnostics.find((line) => TS_ERROR.test(line));
  if (tsError !== undefined) {
    return tsError;
  }
  if (output.code !== 0) {
    const lines = (text: string) =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    return (
      [...lines(output.stdout), ...lines(output.stderr)].find((line) =>
        MANAGER_ERROR.test(line),
      ) ??
      firstLine(output.stderr) ??
      lines(output.stdout).find((line) => line !== "undefined") ??
      `exited with ${String(output.code)}`
    );
  }
  return diagnostics[0];
}

/** The references `--showConfig` printed, or why it can't be read. */
function readShowConfig(
  output: ToolOutput,
): { readonly references: string[] } | { readonly failure: string } {
  const lines = output.stdout.split(/\r?\n/).filter((line) => line !== "");
  if (output.code !== 0) {
    return { failure: failureOf(output, lines) ?? "" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.stdout);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      failure: `printed no JSON object${lines[0] === undefined ? "" : `: ${lines[0]}`}`,
    };
  }
  const references: unknown =
    "references" in parsed ? parsed.references : undefined;
  if (references === undefined) {
    return { references: [] };
  }
  const paths = Array.isArray(references)
    ? (references as unknown[]).map((reference) =>
        typeof reference === "object" &&
        reference !== null &&
        "path" in reference &&
        typeof reference.path === "string"
          ? reference.path
          : undefined,
      )
    : [undefined];
  return paths.every((entry) => entry !== undefined)
    ? { references: paths }
    : {
        failure: `its "references" isn't a list of objects with a string "path"`,
      };
}

/** What a `tsc` or `tsc -p` listing that named no file is: most often a
 * solution config, which only `tsc -b` checks. */
async function explainEmpty(
  lc: ListingContext,
  args: readonly string[],
): Promise<string> {
  const read = readShowConfig(await lc.run("tsc", [...args, "--showConfig"]));
  if ("failure" in read) {
    return `0 file(s); its config couldn't be read: ${read.failure}`;
  }
  return read.references.length > 0
    ? "0 file(s): a solution config, which tsc -p doesn't check; use tsc -b"
    : "0 file(s)";
}

/** One program's files: `tsc [-p <project>] --listFilesOnly`. `-p` is
 * passed only when the script has it, so a bare `tsc` keeps its own
 * search for tsconfig.json. */
function listProgram(
  lc: ListingContext,
  project: string | undefined,
  fromBuild: boolean,
): Promise<Listing> {
  const args = project === undefined ? [] : ["-p", project];
  const command = ["tsc", ...args].join(" ");
  return lc.once(
    ["tsc", ...args, "--listFilesOnly"],
    command,
    "checks",
    async (key) => {
      const output = await lc.run("tsc", [...args, "--listFilesOnly"]);
      const { paths, diagnostics } = readListedFiles(
        output.stdout,
        lc.platform,
      );
      const listing = {
        key,
        command,
        where: lc.where,
        ...(fromBuild ? { note: "from tsc -b" } : {}),
      };
      const failure = failureOf(output, diagnostics);
      if (failure !== undefined) {
        return { ...listing, failure };
      }
      // Kept wherever they lie: comparing them with the files the check
      // requires leaves TypeScript's own libraries out by themselves.
      const files = new Set<string>();
      for (const file of paths) {
        files.add(await lc.real(file));
      }
      return files.size === 0 && !fromBuild
        ? { ...listing, files, explainEmpty: () => explainEmpty(lc, args) }
        : { ...listing, files };
    },
  );
}

/** The config `given` names from `folder` (a folder means its
 * tsconfig.json), joined without following links, or undefined when there
 * is none. tsc reads a config's `include` and `references` from the folder
 * its path names, and tells projects apart by that path, never by where a
 * link leads: two links to one file are two projects. */
async function configAt(
  lc: ListingContext,
  folder: string,
  given: string,
): Promise<string | undefined> {
  const named = path.isAbsolute(given)
    ? path.normalize(given)
    : path.join(folder, given);
  try {
    const real = await lc.ctx.fs.realpath(named);
    if ((await lc.ctx.fs.classify(real)) !== "directory") {
      return named;
    }
    const inside = path.join(named, "tsconfig.json");
    await lc.ctx.fs.realpath(inside);
    return inside;
  } catch {
    return undefined;
  }
}

/** Every config `tsc -b <projects>` builds, depth first, each once by
 * the path tsc reaches it by, so a cycle can't loop; or why the
 * references can't be followed. */
async function buildClosure(
  lc: ListingContext,
  projects: readonly string[],
): Promise<{ readonly configs: string[] } | { readonly failure: string }> {
  const visited = new Set<string>();
  const configs: string[] = [];
  const shown = (config: string): string =>
    path.relative(lc.realFolder, config).split(path.sep).join("/");
  const visit = async (config: string): Promise<string | undefined> => {
    if (visited.has(config)) {
      return undefined;
    }
    visited.add(config);
    configs.push(shown(config));
    const read = readShowConfig(
      await lc.run("tsc", ["-p", shown(config), "--showConfig"]),
    );
    if ("failure" in read) {
      return `tsc -p ${shown(config)} --showConfig: ${read.failure}`;
    }
    for (const reference of read.references) {
      const next = await configAt(lc, path.dirname(config), reference);
      const failed =
        next === undefined
          ? `${shown(config)} references ${reference}, which doesn't exist`
          : await visit(next);
      if (failed !== undefined) {
        return failed;
      }
    }
    return undefined;
  };
  for (const project of projects.length === 0 ? ["tsconfig.json"] : projects) {
    const config = await configAt(lc, lc.realFolder, project);
    const failed =
      config === undefined ? `${project} doesn't exist` : await visit(config);
    if (failed !== undefined) {
      return { failure: failed };
    }
  }
  return { configs };
}

/** The listings one `tsc` command of a typecheck script makes, in order. */
export async function listTypeScript(
  lc: ListingContext,
  part: TypecheckPart,
): Promise<Listing[]> {
  if (part.tool === "tsc") {
    return [await listProgram(lc, part.project, false)];
  }
  const closure = await buildClosure(lc, part.projects);
  if ("failure" in closure) {
    const id = ["tsc", "-b", ...part.projects];
    return [
      {
        key: lc.keyOf(id),
        command: id.join(" "),
        where: lc.where,
        failure: closure.failure,
      },
    ];
  }
  const listings: Listing[] = [];
  for (const config of closure.configs) {
    listings.push(await listProgram(lc, config, true));
  }
  return listings;
}
