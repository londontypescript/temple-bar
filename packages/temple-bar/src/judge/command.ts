// `temple-bar judge`: fails a pull request that changes the checks which
// judge it. It runs in the judge workflow (see workflow.ts), which GitHub
// takes from the default branch, so a pull request can't change the judge by
// editing it. It reads the pull request through the API and never runs it.
//
//   0  the pull request leaves the checks alone
//   1  it changes them, or GitHub couldn't be read (the judge fails closed)
//   2  no pull request to judge: a usage mistake
//
// Outside Actions a maintainer can ask about any pull request with --pr.

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { checkOrigin } from "../init/requirements.ts";
import {
  ASK_FOR_ADMIN_MERGE,
  changesManifest,
  findCheckChanges,
} from "./changes.ts";
import {
  readManifests,
  readPullRequest,
  type PullRequestRef,
} from "./github.ts";

const DEFAULT_API = "https://api.github.com";

function tokenFrom(ctx: Context): string | undefined {
  for (const value of [ctx.env.GH_TOKEN, ctx.env.GITHUB_TOKEN]) {
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function parsePrFlag(args: readonly string[]): number | string | undefined {
  if (args.length === 0) {
    return undefined;
  }
  const [flag, value, ...rest] = args;
  if (flag !== "--pr" || rest.length > 0) {
    return `unknown argument: ${args.join(" ")}`;
  }
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    return "--pr needs a pull request number";
  }
  return Number(value);
}

/** The pull request number from the event GitHub Actions hands the job. */
async function prFromEvent(ctx: Context): Promise<number | undefined> {
  const eventPath = ctx.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === "") {
    return undefined;
  }
  const raw = await ctx.fs.readText(eventPath);
  let event: unknown;
  try {
    event = JSON.parse(raw ?? "");
  } catch {
    return undefined;
  }
  const pr =
    typeof event === "object" && event !== null && "pull_request" in event
      ? event.pull_request
      : undefined;
  const number =
    typeof pr === "object" && pr !== null && "number" in pr
      ? pr.number
      : undefined;
  return typeof number === "number" ? number : undefined;
}

async function repoFrom(
  ctx: Context,
): Promise<{ owner: string; repo: string } | undefined> {
  const [owner, repo, ...rest] = (ctx.env.GITHUB_REPOSITORY ?? "").split("/");
  if (owner && repo && rest.length === 0) {
    return { owner, repo };
  }
  const origin = await checkOrigin(ctx, ctx.cwd);
  return origin.state === "ok" ? origin.origin : undefined;
}

const NO_PULL_REQUEST =
  "judge: no pull request to judge. In GitHub Actions it runs on a " +
  "pull_request_target event; elsewhere pass --pr <number>.\n";

const NEEDS_TOKEN =
  "judge: GitHub Actions gave the judge no token to read the pull request " +
  "with. Add this to the judge step:\n" +
  "  env:\n" +
  "    GH_TOKEN: ${{ github.token }}\n";

/** What the maintainer and the agent read when the judge fails. It says what
 * the pull request touched and who decides, in the same words merge uses
 * when it refuses such a change. */
function formatCheckChanges(findings: readonly string[]): string {
  return (
    "judge: this pull request changes the checks that judge it:\n" +
    findings.map((line) => `  ${line}\n`).join("") +
    "Its own CI can't vouch for a change to that CI, so the maintainer " +
    `decides. ${ASK_FOR_ADMIN_MERGE} Keep a change like this in a pull ` +
    "request of its own, with other work in another one.\n"
  );
}

async function runJudge(
  args: readonly string[],
  ctx: Context,
): Promise<number> {
  const flag = parsePrFlag(args);
  if (typeof flag === "string") {
    ctx.stderr.write(`judge: ${flag}\n`);
    return 2;
  }
  const number = flag ?? (await prFromEvent(ctx));
  const repo = await repoFrom(ctx);
  if (number === undefined || repo === undefined) {
    ctx.stderr.write(NO_PULL_REQUEST);
    return 2;
  }
  const token = tokenFrom(ctx);
  if (token === undefined && ctx.env.GITHUB_ACTIONS === "true") {
    ctx.stderr.write(NEEDS_TOKEN);
    return 1;
  }
  const api = ctx.env.GITHUB_API_URL;
  const pr: PullRequestRef = {
    // GitHub Enterprise Server sets its own API address; an empty value
    // means the same as none.
    api: api === undefined || api === "" ? DEFAULT_API : api,
    ...repo,
    number,
    token,
  };

  const cantRead = (reason: string): number => {
    ctx.stderr.write(
      `judge: could not read pull request #${String(number)} from GitHub: ${reason}. ` +
        "The judge doesn't pass what it hasn't read: run the job again once " +
        "GitHub answers.\n",
    );
    return 1;
  };

  const facts = await readPullRequest(ctx, pr);
  if (!facts.ok) {
    return cantRead(facts.reason);
  }
  let findings: string[];
  if (changesManifest(facts.value.files)) {
    const manifests = await readManifests(ctx, pr, facts.value);
    if (!manifests.ok) {
      return cantRead(manifests.reason);
    }
    findings = findCheckChanges(facts.value.files, manifests.value);
  } else {
    findings = findCheckChanges(facts.value.files);
  }

  if (findings.length > 0) {
    ctx.stderr.write(formatCheckChanges(findings));
    return 1;
  }
  ctx.stdout.write(
    `judge: pull request #${String(number)} leaves the checks alone ` +
      `(${String(facts.value.files.length)} changed files read).\n`,
  );
  return 0;
}

export const judgeCommand: CommandEntry = {
  name: "judge",
  summary: "Fail a pull request that changes the checks which judge it.",
  args: "[--pr <number>]",
  details:
    "Reads the pull request's changed files from GitHub, without checking " +
    "out or running any of its code, and fails when they change a " +
    "workflow, the temple-bar version in package.json, the scripts the " +
    "gate runs, or pnpm's install settings (pnpm-workspace.yaml, a " +
    "pnpmfile, .npmrc). Setup's judge workflow runs it on every pull request.\n\n" +
    "Options:\n" +
    "  --pr <number>  The pull request to judge. In GitHub Actions it comes\n" +
    "                 from the event, and the repository from\n" +
    "                 GITHUB_REPOSITORY; elsewhere from origin.",
  run: runJudge,
};
