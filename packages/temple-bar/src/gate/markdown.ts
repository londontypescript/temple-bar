// The gate's two markdown checks: markdown lint (markdownlint) and the
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

const MARKDOWN_LINT_CHECK = "markdown lint";

/** Only explicit undefined reference labels are universally invalid. Style
 * belongs to project scripts; configuration and lint directives cannot
 * suppress this fixed integrity rule. */
export const MARKDOWN_INTEGRITY_CONFIG: Readonly<Record<string, unknown>> = {
  default: false,
  "temple-bar-reference-labels": true,
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
  const code = await tools.markdownlint(ctx, files, MARKDOWN_INTEGRITY_CONFIG);
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
