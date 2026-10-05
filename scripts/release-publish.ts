// Publishes the draft GitHub Release for a tag, but only once its notes are
// finished and npm actually serves both packages' files for that version:
//
//   node scripts/release-publish.ts v0.0.7
//   node scripts/release-publish.ts v0.0.7 --dry-run
//
// The maintainer runs it after approving both staged versions on npm. npm
// lists a newly approved version in its metadata a few minutes before the
// package file itself downloads, so a release announced on the metadata alone
// points people at a version their package manager can't install yet. This
// script asks for each package file directly, and keeps asking for a few
// minutes before it gives up.
//
// It reads the draft's notes first and refuses while they still carry the
// reminder comment or an empty Upgrading or Incidents section: release 0.0.7
// was published with its notes unfinished.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { unfinishedNotes } from "./release-notes.ts";

const REGISTRY = "https://registry.npmjs.org";

/** How long npm gets to start serving the files, and how often we ask. */
export const WAIT_MS = 5 * 60 * 1000;
export const RETRY_MS = 15 * 1000;

/** The package folders, in the order the maintainer approves them on npm. */
const PACKAGE_DIRS = ["packages/temple-bar", "packages/create-temple-bar"];

/** Everything outside this file the script touches, so tests can fake it. */
export interface PublishDeps {
  /** HTTP status of a full download of `url`; 0 when the request fails. */
  readonly download: (url: string) => Promise<number>;
  /** The GitHub Release for `tag`: whether it is a draft, and its notes.
   * Undefined if there is none. */
  readonly viewRelease: (tag: string) => ReleaseView | undefined;
  /** Turns the draft GitHub Release for `tag` into a published one. */
  readonly publishRelease: (tag: string) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
}

export interface ReleaseView {
  readonly isDraft: boolean;
  readonly body: string;
}

export interface PublishOptions {
  readonly tag: string;
  readonly packageNames: readonly string[];
  readonly dryRun: boolean;
}

/** Where npm serves a package's file, built from the name and version alone
 * rather than read from the registry's metadata, because the metadata is the
 * part that appears first. */
export function tarballUrl(name: string, version: string): string {
  const base = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${REGISTRY}/${name}/-/${base}-${version}.tgz`;
}

/** Waits for every package file to download, then publishes the draft.
 * Returns the process exit code: 0 published (or would be, on a dry run),
 * 1 refused. */
export async function publishWhenDownloadable(
  options: PublishOptions,
  deps: PublishDeps,
): Promise<number> {
  const { tag, packageNames, dryRun } = options;
  const version = tag.replace(/^v/, "");

  const release = deps.viewRelease(tag);
  const draft = release?.isDraft;
  if (draft !== true && !dryRun) {
    deps.log(
      draft === undefined
        ? `No GitHub Release exists for ${tag}. The release workflow drafts one when the tag is pushed; check that it finished, then run this again.`
        : `The GitHub Release for ${tag} is already published. Nothing to do.`,
    );
    return 1;
  }

  // Checked before waiting on npm, so unfinished notes are found at once.
  // A dry run checks them too, so it never says a draft is ready when it isn't.
  const problems =
    release?.isDraft === true ? unfinishedNotes(release.body) : [];
  if (problems.length > 0) {
    deps.log(
      [
        `Not published: the draft notes for ${tag} aren't finished:`,
        ...problems.map((problem) => `  - ${problem}`),
        `Edit the draft on GitHub (or gh release edit ${tag} --notes-file <file>), then run this again.`,
      ].join("\n"),
    );
    return 1;
  }

  const urls = packageNames.map((name) => tarballUrl(name, version));
  const deadline = deps.now() + WAIT_MS;
  for (;;) {
    const missing: string[] = [];
    for (const url of urls) {
      const status = await deps.download(url);
      if (status !== 200) {
        missing.push(
          `${url} (${status === 0 ? "no response" : `HTTP ${String(status)}`})`,
        );
      }
    }
    if (missing.length === 0) {
      break;
    }
    if (deps.now() >= deadline) {
      deps.log(
        [
          `Not published: npm still doesn't serve these files after ${String(WAIT_MS / 60_000)} minutes:`,
          ...missing.map((line) => `  ${line}`),
          `Check that both staged versions are approved on npm (npm stage list <package>), then run this again for ${tag}.`,
        ].join("\n"),
      );
      return 1;
    }
    deps.log(`Waiting for npm to serve: ${missing.join(", ")}`);
    await deps.sleep(RETRY_MS);
  }

  if (dryRun) {
    deps.log(
      `Both packages download for ${tag}. Dry run: the GitHub Release was left as it is${draft === true ? " (a draft)" : ""}.`,
    );
    return 0;
  }
  deps.publishRelease(tag);
  deps.log(
    `Both packages download for ${tag}, so its GitHub Release is now published.`,
  );
  return 0;
}

async function download(url: string): Promise<number> {
  try {
    const response = await fetch(url);
    // Read the whole body: a 200 whose download then breaks is not served.
    await response.arrayBuffer();
    return response.status;
  } catch {
    return 0;
  }
}

function viewRelease(tag: string): ReleaseView | undefined {
  try {
    const out = execFileSync(
      "gh",
      ["release", "view", tag, "--json", "isDraft,body"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out) as ReleaseView;
  } catch {
    return undefined;
  }
}

function publishRelease(tag: string): void {
  execFileSync("gh", ["release", "edit", tag, "--draft=false"], {
    stdio: "inherit",
  });
}

function packageName(dir: string): string {
  const pkg = JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as {
    name: string;
  };
  return pkg.name;
}

async function main(args: readonly string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const [tag, ...rest] = args.filter((arg) => arg !== "--dry-run");
  if (tag === undefined || rest.length > 0 || !/^v\d/.test(tag)) {
    process.stderr.write(
      "usage: node scripts/release-publish.ts <tag> [--dry-run]   (for example v0.0.7)\n",
    );
    process.exitCode = 2;
    return;
  }
  process.exitCode = await publishWhenDownloadable(
    { tag, packageNames: PACKAGE_DIRS.map(packageName), dryRun },
    {
      download,
      viewRelease,
      publishRelease,
      now: Date.now,
      sleep: (ms) => delay(ms),
      log: (line) => {
        process.stdout.write(`${line}\n`);
      },
    },
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main(process.argv.slice(2));
}
