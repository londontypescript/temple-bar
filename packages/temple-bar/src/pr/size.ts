// The pull request size warning (never a failure). A squash merge turns each
// pull request into one commit on main, so a pull request should hold one
// concern: this flags one that is too big, or that closes several issues.
//
// `warnAboutPullRequestSize` is the entry point both `temple-bar pr-size`
// and a later `temple-bar merge` call, so the warning reads the same in CI,
// on a laptop and when asking to merge.

import {
  readProjectConfig,
  type ProjectConfig,
} from "../config/project-config.ts";
import type { Context } from "../context.ts";
import { findClosingIssues, readPullRequestText } from "./closing-issues.ts";
import { measureDiff, type DiffSize } from "./diff.ts";

export interface PullRequestSizeOptions {
  /** Ref the pull request merges into, e.g. "origin/main". */
  readonly base: string;
  /** Ref of the pull request's tip; HEAD in a checkout of the branch. */
  readonly head: string;
  /** Pull request number for `gh`, when not reading CI's event payload. */
  readonly prNumber?: string;
  /** True before a pull request exists (a push): there is no title or body to
   * read, and asking `gh` would go to the network for nothing. */
  readonly skipPullRequestText?: boolean;
}

export interface PullRequestSizeReport {
  readonly size: DiffSize;
  /** Issues the title and body close; undefined when they couldn't be read. */
  readonly closedIssues: readonly string[] | undefined;
  readonly limits: Pick<
    ProjectConfig,
    "maxPullRequestLines" | "maxPullRequestFiles"
  >;
  /** One sentence per reason to warn; empty means all is well. */
  readonly problems: readonly string[];
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-GB")} ${noun}${count === 1 ? "" : "s"}`;
}

export async function checkPullRequestSize(
  ctx: Context,
  options: PullRequestSizeOptions,
): Promise<PullRequestSizeReport> {
  const config = await readProjectConfig(ctx);
  const size = await measureDiff(ctx, options.base, options.head);
  const text =
    options.skipPullRequestText === true
      ? undefined
      : await readPullRequestText(ctx, options.prNumber);
  const closedIssues =
    text === undefined
      ? undefined
      : findClosingIssues([text.title, text.body], text.repository);

  const problems: string[] = [];
  if (size.linesChanged > config.maxPullRequestLines) {
    problems.push(
      `it changes ${plural(size.linesChanged, "line")} (limit ${config.maxPullRequestLines.toLocaleString("en-GB")})`,
    );
  }
  if (size.filesTouched > config.maxPullRequestFiles) {
    problems.push(
      `it touches ${plural(size.filesTouched, "file")} (limit ${config.maxPullRequestFiles.toLocaleString("en-GB")})`,
    );
  }
  if (closedIssues !== undefined && closedIssues.length > 1) {
    problems.push(
      `it closes ${plural(closedIssues.length, "issue")}: ${closedIssues.join(", ")}`,
    );
  }
  return {
    size,
    closedIssues,
    limits: {
      maxPullRequestLines: config.maxPullRequestLines,
      maxPullRequestFiles: config.maxPullRequestFiles,
    },
    problems,
  };
}

function describe(report: PullRequestSizeReport): string {
  const issues =
    report.closedIssues === undefined
      ? "closing issues not checked (no pull request text available)"
      : `closes ${plural(report.closedIssues.length, "issue")}`;
  return `${plural(report.size.linesChanged, "line")} changed across ${plural(report.size.filesTouched, "file")}; ${issues}`;
}

/** The human-readable text: the warning, or a one-line all-clear. */
export function formatSizeReport(report: PullRequestSizeReport): string {
  if (report.problems.length === 0) {
    return `pr-size: ok: ${describe(report)}\n`;
  }
  const lines = [
    "pr-size: warning: this pull request may be too big or mix concerns:",
    ...report.problems.map((problem) => `  - ${problem}`),
    "A squash merge makes each pull request one commit on main, so keep one concern per pull request: open one pull request per issue.",
    "If the issues really are one concern, add a line to the description starting `One concern:` that says why.",
  ];
  return `${lines.join("\n")}\n`;
}

/** GitHub Actions turns this line into an annotation on the pull request.
 * Its data must be one line, with %, CR and LF escaped. */
function formatAnnotation(report: PullRequestSizeReport): string {
  const message = `This pull request may be too big or mix concerns: ${report.problems.join("; ")}. Open one pull request per issue, or add a \`One concern:\` line to the description that says why they are one concern.`;
  const escaped = message
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  return `::warning title=Pull request size::${escaped}\n`;
}

/** Measures, prints the warning (or an all-clear), and returns the report.
 * Never fails the caller: a warning is advice, not a gate. */
export async function warnAboutPullRequestSize(
  ctx: Context,
  options: PullRequestSizeOptions,
): Promise<PullRequestSizeReport> {
  const report = await checkPullRequestSize(ctx, options);
  ctx.stdout.write(formatSizeReport(report));
  if (report.problems.length > 0 && ctx.env.GITHUB_ACTIONS === "true") {
    ctx.stdout.write(formatAnnotation(report));
  }
  return report;
}
