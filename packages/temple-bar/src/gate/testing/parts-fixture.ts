// The gate split by part, through fakes: a GitHub Actions environment, a
// HEAD to report, and part reports kept in memory, so a test can run every
// part of a fake workspace to its report and then verify them. Not shipped:
// the build tsconfig excludes every `testing/` folder.

import path from "node:path";

import type { Context } from "../../context.ts";
import { createGateCommand } from "../command.ts";
import type { EntryKind, PartFiles } from "../part-files.ts";
import { parsePartReport, type PartReport } from "../part-report.ts";
import { createFakeTools } from "./fake-tools.ts";
import { PNPM_EXEC } from "./workspace-fixture.ts";

/** The commit the fake HEAD names. */
export const HEAD = "a".repeat(40);

/** A GitHub Actions run, started through the fake pnpm. */
export const ACTIONS_ENV: Readonly<NodeJS.ProcessEnv> = {
  npm_execpath: PNPM_EXEC,
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "owner/project",
  GITHUB_RUN_ID: "4242",
  GITHUB_RUN_ATTEMPT: "1",
};

/** Where the tests keep the reports. */
export const REPORTS = path.resolve("/reports");

export interface FakePartFiles extends PartFiles {
  /** Every regular file's text, by absolute path. */
  readonly entries: Map<string, string>;
  /** Every other entry's kind, by absolute path. */
  readonly others: Map<string, Exclude<EntryKind, "file" | "missing">>;
  /** Reports written, by absolute path, in order. */
  readonly written: string[];
}

export function createFakePartFiles(): FakePartFiles {
  const entries = new Map<string, string>();
  const others = new Map<string, Exclude<EntryKind, "file" | "missing">>();
  const written: string[] = [];
  const every = () => [...entries.keys(), ...others.keys()];
  const kindOf = (target: string): EntryKind => {
    const key = path.resolve(target);
    if (entries.has(key)) {
      return "file";
    }
    // A folder is there when something is in it.
    return (
      others.get(key) ??
      (every().some((each) => path.dirname(each) === key)
        ? "directory"
        : "missing")
    );
  };
  return {
    entries,
    others,
    written,
    kind: (target) => Promise.resolve(kindOf(target)),
    list(folder) {
      return kindOf(folder) === "directory"
        ? Promise.resolve(
            every()
              .filter((key) => path.dirname(key) === path.resolve(folder))
              .map((key) => path.basename(key)),
          )
        : Promise.reject(new Error(`ENOENT: no such folder ${folder}`));
    },
    read(target) {
      const text = entries.get(path.resolve(target));
      return text === undefined
        ? Promise.reject(new Error(`can't read ${target}`))
        : Promise.resolve(text);
    },
    createNew(target, text) {
      const key = path.resolve(target);
      if (kindOf(key) !== "missing") {
        return Promise.reject(new Error(`EEXIST: file already exists`));
      }
      entries.set(key, text);
      written.push(key);
      return Promise.resolve();
    },
  };
}

/** `ctx` with a git that also answers `rev-parse --verify HEAD`. */
export function withHead(ctx: Context, head = HEAD): Context {
  return {
    ...ctx,
    git: {
      run(args, cwd) {
        return args.join(" ") === "rev-parse --verify HEAD"
          ? Promise.resolve({ code: 0, stdout: `${head}\n`, stderr: "" })
          : ctx.git.run(args, cwd);
      },
    },
  };
}

/** Runs `temple-bar gate <args>` with passing npm tools and `files`. */
export function runGate(
  ctx: Context,
  files: PartFiles,
  args: readonly string[],
): Promise<number> {
  return createGateCommand(createFakeTools(), files).run(args, ctx);
}

/** `--part <part> --leg <leg> --report <REPORTS>/<file>`. */
export function partArgs(
  part: string,
  file: string,
  leg = "windows",
): string[] {
  return ["--part", part, "--leg", leg, "--report", path.join(REPORTS, file)];
}

/** The report at `file` in the reports' folder; throws when there is none
 * or it is malformed. */
export function readReport(files: FakePartFiles, file: string): PartReport {
  const text = files.entries.get(path.join(REPORTS, file));
  if (text === undefined) {
    throw new Error(`no report at ${file}`);
  }
  const report = parsePartReport(text);
  if (typeof report === "string") {
    throw new Error(`${file} is malformed: ${report}`);
  }
  return report;
}

/** A file name for `part`'s report. */
export function reportFile(part: string): string {
  return `${part.replaceAll("/", "-")}.json`;
}
