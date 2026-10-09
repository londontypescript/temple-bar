// Run the mandatory reference-label rule in process. Project Markdown
// configurations belong to project scripts, so none are discovered here.
import path from "node:path";

import { lint } from "markdownlint/promise";
import type { LintError, Rule } from "markdownlint";

import type { Context } from "../context.ts";
import { readMarkdownTokens } from "./links-parse.ts";

// The pinned stock MD052 does not request its parser and misidentifies valid
// Unicode and container labels. Public parser tokens already distinguish
// unresolved full/collapsed syntax from resolved references and bracket prose.
const referenceLabels: Rule = {
  names: ["temple-bar-reference-labels"],
  description: "Explicit reference labels must be defined",
  tags: ["links"],
  parser: "micromark",
  function(params, onError) {
    const { undefinedReferences } = readMarkdownTokens(
      params.parsers.micromark.tokens,
      0,
    );
    for (const token of undefinedReferences) {
      const name =
        token.children[0]?.children
          .filter((child) => child.type !== "blockQuotePrefix")
          .map((child) => child.text)
          .join("")
          .replace(/[\t\n\r ]+/g, " ") ?? "";
      const context =
        params.lines[token.startLine - 1]?.slice(
          token.startColumn - 1,
          token.startColumn - 1 + token.text.length,
        ) ?? "";
      onError({
        lineNumber: token.startLine,
        detail: `Missing link or image reference definition: "${name}"`,
        context,
        range: [token.startColumn, Math.min(token.text.length, context.length)],
      });
    }
  },
};

function formatError(file: string, error: LintError): string {
  const column =
    error.errorRange === null ? "" : `:${String(error.errorRange[0])}`;
  const detail = error.errorDetail === null ? "" : ` [${error.errorDetail}]`;
  const context =
    error.errorContext === null ? "" : ` [Context: "${error.errorContext}"]`;
  return `${file}:${String(error.lineNumber)}${column} ${error.ruleNames.join("/")} ${error.ruleDescription}${detail}${context}`;
}

/** Lints Git-listed files with the gate's fixed integrity configuration.
 * Resolves 0 clean, 1 invalid labels, 2 couldn't run. */
export async function runMarkdownlint(
  ctx: Context,
  files: readonly string[],
  integrityConfig: Readonly<Record<string, unknown>>,
): Promise<number> {
  try {
    const absolute = files.map((file) => path.join(ctx.cwd, file));
    const results = await lint({
      files: absolute,
      config: { ...integrityConfig },
      customRules: [referenceLabels],
      noInlineConfig: true,
    });
    let errors = 0;
    for (const [file, fileErrors] of Object.entries(results)) {
      const relative = path.relative(ctx.cwd, file).split(path.sep).join("/");
      for (const error of fileErrors) {
        ctx.stderr.write(`${formatError(relative, error)}\n`);
        errors++;
      }
    }
    return errors === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`gate: markdownlint could not run: ${message}\n`);
    return 2;
  }
}
