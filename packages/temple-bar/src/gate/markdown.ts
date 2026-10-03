// The gate's two markdown checks: markdown lint (markdownlint-cli2) and the
// built-in local link check (links.ts). Both read the markdown files git
// lists, the same file set as every other check, so built output, vendored
// packages and nested worktrees are never linted.

import type { Context } from "../context.ts";
import {
  checkLocalLinks,
  formatBrokenLinks,
  isMarkdownPath,
  LINKS_CHECK,
} from "./links.ts";
import type { CheckOutcome } from "./report.ts";
import type { GateTools } from "./tools.ts";

export const MARKDOWN_LINT_CHECK = "markdown lint";

/** markdownlint's own rules, minus the ones about layout: line length,
 * spacing, list indents and marker styles. Layout is the format:check
 * script's job, and these rules disagree with Prettier, so linting them too
 * would fail files the formatter just wrote. The list is markdownlint's own
 * "prettier" style. A project with its own markdownlint config file uses
 * that instead. */
export const DEFAULT_MARKDOWNLINT_CONFIG: Readonly<Record<string, unknown>> = {
  default: true,
  "blanks-around-fences": false,
  "blanks-around-headings": false,
  "blanks-around-lists": false,
  "code-fence-style": false,
  "emphasis-style": false,
  "heading-start-left": false,
  "heading-style": false,
  "hr-style": false,
  "line-length": false,
  "list-indent": false,
  "list-marker-space": false,
  "no-blanks-blockquote": false,
  "no-hard-tabs": false,
  "no-missing-space-atx": false,
  "no-missing-space-closed-atx": false,
  "no-multiple-blanks": false,
  "no-multiple-space-atx": false,
  "no-multiple-space-blockquote": false,
  "no-multiple-space-closed-atx": false,
  "no-trailing-spaces": false,
  "ol-prefix": false,
  "strong-style": false,
  "ul-indent": false,
};

function markdownFiles(listed: readonly string[]): string[] {
  return listed.filter((file) => isMarkdownPath(file) && !file.endsWith("/"));
}

export async function runMarkdownLint(
  ctx: Context,
  tools: GateTools,
  listed: readonly string[],
): Promise<CheckOutcome> {
  const files = markdownFiles(listed);
  if (files.length === 0) {
    return {
      name: MARKDOWN_LINT_CHECK,
      status: "skipped",
      detail: "no markdown files",
    };
  }
  const code = await tools.markdownlint(
    ctx,
    files,
    DEFAULT_MARKDOWNLINT_CONFIG,
  );
  if (code === 0) {
    return {
      name: MARKDOWN_LINT_CHECK,
      status: "passed",
      detail: `${String(files.length)} markdown file(s)`,
    };
  }
  ctx.stderr.write(
    code === 1
      ? "gate: markdown lint found problems (listed above): fix each one in the file it names\n"
      : "gate: markdown lint could not run (see the error above)\n",
  );
  return {
    name: MARKDOWN_LINT_CHECK,
    status: "failed",
    detail: code === 1 ? "lint errors" : `could not run (exit ${String(code)})`,
  };
}

export async function runLinkCheck(
  ctx: Context,
  listed: readonly string[],
): Promise<CheckOutcome> {
  const result = await checkLocalLinks(ctx, listed);
  if (result.documents === 0) {
    return {
      name: LINKS_CHECK,
      status: "skipped",
      detail: "no markdown files",
    };
  }
  if (result.broken.length > 0) {
    ctx.stderr.write(formatBrokenLinks(result.broken));
    return {
      name: LINKS_CHECK,
      status: "failed",
      detail: `${String(result.broken.length)} broken`,
    };
  }
  return {
    name: LINKS_CHECK,
    status: "passed",
    detail: `${String(result.documents)} markdown file(s)`,
  };
}
