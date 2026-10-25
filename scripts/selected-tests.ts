// The gate runs the root's `test` script and then each workspace package's,
// and between them they must run every test file exactly once. The root's
// covers scripts/ and e2e/; each package's covers its own src/. A test file
// outside every selection would quietly stop running, and one inside two would
// run twice, so this compares what the scripts actually select with an
// inventory taken separately, from every file git tracks.

import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every file name Node's test runner picks by default (`node --test` with no
 * files given), wildcards matching nothing included (`_test.ts`, `test-.ts`),
 * so a test file named any of these ways is found even if no script would
 * select it. It errs wide: a name it matches that Node wouldn't run fails the
 * check, never passes it. */
const DEFAULT_TEST_FILE =
  /(?:^|\/)(?:[^/]*[.\-_]test|test-[^/]*|test)\.[cm]?[jt]s$|(?:^|\/)test\/.+\.[cm]?[jt]s$/;

/** Whether Node's test runner would take `file` for a test by its name. */
export function isDefaultTestFile(file: string): boolean {
  return DEFAULT_TEST_FILE.test(file);
}

/** One `test` script, in the folder it runs from ("" for the root). */
export interface TestScript {
  readonly folder: string;
  readonly command: string;
}

/** The global setup every `test` script names first, as reached from the
 * script's folder. On Windows it holds Git's shared /tmp for the run, so a
 * script that drops it, or names another, is refused rather than quietly
 * running without it. */
function globalSetupWord(folder: string): string {
  const up = folder === "" ? "./" : "../".repeat(folder.split("/").length);
  return `--test-global-setup=${up}scripts/run-tests/anchor.ts`;
}

/** The file patterns a `test` script hands the test runner. A script must be
 * exactly `node`, `--test-global-setup=<path>scripts/run-tests/anchor.ts`, any
 * `--import <file>` pairs, then `--test` and its file patterns. A bare
 * `--test` would let the runner discover files from wherever it starts, and
 * any other flag (`--test-shard`, a name pattern) could run fewer files or
 * tests than its patterns select; nothing here models either, so both are
 * refused. So is any shell syntax but double quotes: a single-quoted flag, or
 * a second command after `&&`, would reach the runner looking like a file
 * pattern here. */
export function testPatterns(script: TestScript): string[] {
  const where = script.folder === "" ? "the root" : script.folder;
  const refuse = (why: string): never => {
    throw new Error(`${where}'s test script ${why}: ${script.command}`);
  };
  if (/['\\`$;|&<>()]/.test(script.command)) {
    refuse("may use no shell syntax but double quotes");
  }
  // Only single spaces separate words: a line break would start a second
  // command, whose words would otherwise be read here as file patterns.
  if (!/^\S+(?: \S+)*$/.test(script.command)) {
    refuse("may separate its words only with single spaces");
  }
  // Each word is plain, or one whole double-quoted pattern: two quoted parts
  // written together would reach the runner as one pattern the shell joined.
  // No `!` either: with delayed expansion on, Windows' cmd.exe rewrites it.
  const words = script.command.split(" ");
  const matches = words.map((word) =>
    /^(?:"([\w./*?[\]{},@:+=-]+)"|([\w./@:+=-]+))$/.exec(word),
  );
  if (matches.some((match) => match === null)) {
    refuse("may hold only plain words and whole double-quoted patterns");
  }
  const tokens = matches.map((match) => match?.[1] ?? match?.[2] ?? "");
  const setup = globalSetupWord(script.folder);
  if (tokens[0] !== "node" || tokens[1] !== setup) {
    refuse(`must start with node ${setup}`);
  }
  let at = 2;
  while (
    tokens[at] === "--import" &&
    tokens[at + 1] !== undefined &&
    !(tokens[at + 1] ?? "").startsWith("-")
  ) {
    at += 2;
  }
  if (tokens[at] !== "--test") {
    refuse("may hold only --import <file> pairs before --test");
  }
  const patterns = tokens.slice(at + 1);
  // Unquoted, the shell would expand a pattern itself, by its own rules.
  if (matches.slice(at + 1).some((match) => match?.[1] === undefined)) {
    refuse("must double-quote each file pattern");
  }
  if (patterns.length === 0) {
    refuse("must name its test files after --test");
  }
  if (patterns.some((pattern) => pattern.startsWith("-"))) {
    refuse("may hold only file patterns after --test");
  }
  return patterns;
}

/** Every repo-relative file a script selects, expanded from its folder. Each
 * file counts once per script, as the runner runs it once however many of
 * the script's patterns match it. */
export function selectedFiles(
  root: string,
  script: TestScript,
): readonly string[] {
  const folder = path.join(root, script.folder);
  const files = testPatterns(script).flatMap((pattern) => {
    const matched = globSync(pattern, {
      cwd: folder,
      exclude: (name) => path.basename(name) === "node_modules",
    });
    // A pattern that matches nothing is a typo or a flag in disguise.
    if (matched.length === 0) {
      throw new Error(
        `${script.folder === "" ? "the root" : script.folder}'s test script names a pattern that matches no file: ${pattern}`,
      );
    }
    return matched.map((file) =>
      path.relative(root, path.join(folder, file)).split(path.sep).join("/"),
    );
  });
  return [...new Set(files)];
}

/** What is wrong with a selection: each tracked test file no script runs, and
 * each file more than one selection runs. Empty when every file runs once. */
export function selectionProblems(
  tracked: readonly string[],
  selections: readonly { script: string; files: readonly string[] }[],
): string[] {
  const runs = new Map<string, string[]>();
  for (const { script, files } of selections) {
    for (const file of files) {
      runs.set(file, [...(runs.get(file) ?? []), script]);
    }
  }
  const problems: string[] = [];
  for (const file of tracked) {
    const scripts = runs.get(file) ?? [];
    if (scripts.length === 0) {
      problems.push(`${file} is run by no test script`);
    } else if (scripts.length > 1) {
      problems.push(`${file} is run more than once: ${scripts.join(", ")}`);
    }
  }
  return problems;
}

/** The test files git tracks, by Node's own default naming. */
export function trackedTestFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(isDefaultTestFile)
    .filter((file) => !file.split("/").includes("node_modules"));
}

/** The root's `test` script and every workspace package's. */
export function testScripts(root: string): TestScript[] {
  const workspace = readFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "utf8",
  );
  // Only the `packages:` list names packages; the file can hold other lists.
  const block = /^packages:[ \t]*\n((?:[ \t]+.*\n?)*)/m.exec(workspace)?.[1];
  const patterns = [...(block ?? "").matchAll(/^\s*-\s*["']?([^"'\s]+)/gm)]
    .map((match) => match[1] ?? "")
    .filter((pattern) => pattern !== "");
  if (patterns.length === 0 || patterns.some((p) => p.startsWith("!"))) {
    throw new Error(
      "pnpm-workspace.yaml must list its packages, with no exclusions, for this check to find their test scripts",
    );
  }
  const folders = [
    "",
    ...patterns
      .flatMap((pattern) => globSync(`${pattern}/package.json`, { cwd: root }))
      .map((file) => path.dirname(file).split(path.sep).join("/"))
      .sort(),
  ];
  return folders.map((folder) => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, folder, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const command = manifest.scripts?.test;
    if (command === undefined) {
      throw new Error(`${folder || "the root"} has no test script`);
    }
    return { folder, command };
  });
}
