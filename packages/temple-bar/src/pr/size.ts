// The pull request size report. A squash merge turns each pull request into
// one commit on main, so a pull request should hold one concern: this flags
// one that is over the size limits, or that closes several issues, unless
// its description has a `One concern:` line saying why it is one change.
//
// The report is advice wherever it is printed (`temple-bar pr-size` in CI,
// the pre-push hook). `temple-bar merge` builds the same report and refuses
// what it flags, so the wording reads the same everywhere.

import {
  readProjectConfig,
  type ProjectConfig,
} from "../config/project-config.ts";
import type { Context } from "../context.ts";
import { hasOneConcernLine, oneConcernVerdict } from "../merge/one-concern.ts";
import {
  findClosingIssues,
  readPullRequestText,
  type PullRequestText,
} from "./closing-issues.ts";
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
  /** The title and body the caller already holds. Merge passes the copy it
   * is about to merge, so the report judges that text and reads nothing
   * from `gh` or the event payload. */
  readonly pullRequestText?: PullRequestText;
}

type SizeLimits = Pick<
  ProjectConfig,
  "maxPullRequestLines" | "maxPullRequestTestLines" | "maxPullRequestFiles"
>;

export interface PullRequestSizeReport {
  readonly size: DiffSize;
  /** Issues the title and body close; undefined when they couldn't be read. */
  readonly closedIssues: readonly string[] | undefined;
  /** Whether the description has a valid `One concern:` line; undefined
   * when no description was read (before a push). */
  readonly oneConcernLine: boolean | undefined;
  readonly limits: SizeLimits;
  /** Each size limit crossed, e.g. "612 lines of source changed, limit 500". */
  readonly overages: readonly string[];
  /** One sentence per reason to warn; empty means nothing to warn about,
   * which includes an oversized pull request whose `One concern:` line says
   * why it is one change. */
  readonly problems: readonly string[];
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-GB")} ${noun}${count === 1 ? "" : "s"}`;
}

function findOverages(size: DiffSize, limits: SizeLimits): string[] {
  const measured: [number, number, string, string][] = [
    [size.sourceLines, limits.maxPullRequestLines, "line", "of source changed"],
    [
      size.testLines,
      limits.maxPullRequestTestLines,
      "line",
      "of tests changed",
    ],
    [size.filesTouched, limits.maxPullRequestFiles, "file", "touched"],
  ];
  return measured
    .filter(([count, limit]) => count > limit)
    .map(
      ([count, limit, noun, what]) =>
        `${plural(count, noun)} ${what}, limit ${limit.toLocaleString("en-GB")}`,
    );
}

export async function checkPullRequestSize(
  ctx: Context,
  options: PullRequestSizeOptions,
): Promise<PullRequestSizeReport> {
  const config = await readProjectConfig(ctx);
  const size = await measureDiff(ctx, options.base, options.head);
  const text =
    options.pullRequestText ??
    (options.skipPullRequestText === true
      ? undefined
      : await readPullRequestText(ctx, options.prNumber));
  const closedIssues =
    text === undefined
      ? undefined
      : findClosingIssues([text.title, text.body], text.repository);
  const limits: SizeLimits = {
    maxPullRequestLines: config.maxPullRequestLines,
    maxPullRequestTestLines: config.maxPullRequestTestLines,
    maxPullRequestFiles: config.maxPullRequestFiles,
  };
  const overages = findOverages(size, limits);

  // Only a description that was read can carry the line; before a push
  // there is none, so the reminder stays.
  const given =
    text !== undefined &&
    closedIssues !== undefined &&
    oneConcernVerdict(text.body, closedIssues, overages) === "given";
  const problems = given ? [] : [...overages];
  if (!given && closedIssues !== undefined && closedIssues.length > 1) {
    problems.push(
      `it closes ${plural(closedIssues.length, "issue")}: ${closedIssues.join(", ")}`,
    );
  }
  return {
    size,
    closedIssues,
    oneConcernLine:
      text === undefined ? undefined : hasOneConcernLine(text.body),
    limits,
    overages,
    problems,
  };
}

function describe(report: PullRequestSizeReport): string {
  const { size } = report;
  const lines = `${plural(size.sourceLines, "source line")} and ${plural(size.testLines, "test line")}`;
  const issues =
    report.closedIssues === undefined
      ? "closing issues not checked (no pull request text available)"
      : `closes ${plural(report.closedIssues.length, "issue")}`;
  const line =
    report.oneConcernLine === true
      ? "; its description has a `One concern:` line"
      : "";
  return `${lines} changed across ${plural(size.filesTouched, "file")}; ${issues}${line}`;
}

const SPLIT_OR_SAY_WHY =
  "split it (one pull request per issue), or add a line to the description starting `One concern:` that says why it is one change";
const MERGE_REQUIRES_IT =
  "`temple-bar merge` requires that line for a pull request over the size limits or closing several issues";

/** The human-readable text: the warning, one information line for an
 * oversized pull request whose `One concern:` line explains it, or a
 * one-line all-clear. */
export function formatSizeReport(report: PullRequestSizeReport): string {
  if (report.problems.length === 0 && report.overages.length > 0) {
    return `pr-size: over the size limits (${report.overages.join("; ")}); its \`One concern:\` line says why it is one change\n`;
  }
  if (report.problems.length === 0) {
    return `pr-size: ok: ${describe(report)}\n`;
  }
  const lines = [
    "pr-size: warning: this pull request may be too big or mix concerns:",
    ...report.problems.map((problem) => `  - ${problem}`),
    `A squash merge makes each pull request one commit on main, so keep one concern per pull request: ${SPLIT_OR_SAY_WHY}.`,
    `${MERGE_REQUIRES_IT}.`,
  ];
  return `${lines.join("\n")}\n`;
}

/** GitHub Actions turns this line into an annotation on the pull request.
 * Its data must be one line, with %, CR and LF escaped. */
function formatAnnotation(report: PullRequestSizeReport): string {
  const message = `This pull request may be too big or mix concerns: ${report.problems.join("; ")}. Keep one concern per pull request: ${SPLIT_OR_SAY_WHY}; ${MERGE_REQUIRES_IT}.`;
  const escaped = message
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  return `::warning title=Pull request size::${escaped}\n`;
}

/** Measures, prints the warning (or the information line, or an all-clear),
 * and returns the report. Never fails the caller over what it finds: here
 * the report is advice, and merge is where it is enforced. */
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
