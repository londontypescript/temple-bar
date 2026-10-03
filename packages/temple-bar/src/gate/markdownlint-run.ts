// Runs markdownlint's own library on the files the gate lists, in process.
//
// The library, not the markdownlint-cli2 command: the gate already knows
// exactly which files to lint, so it needs none of the command's file
// matching, and that matching brought in a dependency with a known,
// unpatched flaw. What the command added besides is finding a project's
// own settings; that is done here, for the two formats markdownlint reads
// without extra parsers: `.markdownlint.json` and `.markdownlint.jsonc` at
// the top of the repo. A project keeping its settings in another format
// is told where to move them, rather than having them silently ignored.

import path from "node:path";

import { readConfig, lint } from "markdownlint/promise";
import type { Configuration, LintError } from "markdownlint";

import type { Context } from "../context.ts";

/** The settings files read, in the order they are looked for. */
const CONFIG_FILES = [".markdownlint.jsonc", ".markdownlint.json"] as const;

/** Settings files markdownlint-cli2 would read that the gate doesn't. */
const UNREAD_CONFIG_FILES = [
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint.cjs",
  ".markdownlint.mjs",
  ".markdownlint-cli2.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.cjs",
  ".markdownlint-cli2.mjs",
] as const;

/** The first character from `start` on that isn't space or a comment. */
function nextSignificant(text: string, start: number): string {
  let i = start;
  while (i < text.length) {
    const char = text[i] ?? "";
    if (/\s/.test(char)) {
      i++;
    } else if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      return char;
    }
  }
  return "";
}

/** JSON with comments and trailing commas, as `.jsonc` files allow, turned
 * into plain JSON. Text inside strings is kept exactly as written. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (char === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        i += text[i] === "\\" ? 2 : 1;
      }
      i++;
      out += text.slice(start, i);
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === ",") {
      // A comma with only space and comments before the closing bracket is
      // a trailing comma, which plain JSON refuses.
      const following = nextSignificant(text, i + 1);
      if (following !== "}" && following !== "]") {
        out += char;
      }
      i++;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

function parseJsonc(text: string): Configuration {
  return JSON.parse(stripJsonc(text)) as Configuration;
}

function formatError(file: string, error: LintError): string {
  const column =
    error.errorRange === null ? "" : `:${String(error.errorRange[0])}`;
  const detail = error.errorDetail === null ? "" : ` [${error.errorDetail}]`;
  const context =
    error.errorContext === null ? "" : ` [Context: "${error.errorContext}"]`;
  return `${file}:${String(error.lineNumber)}${column} ${error.ruleNames.join("/")} ${error.ruleDescription}${detail}${context}`;
}

/** Lints `files` (relative to ctx.cwd) with the project's own settings when
 * it has them, else `defaultConfig`. Resolves 0 clean, 1 lint errors, 2
 * couldn't run. */
export async function runMarkdownlint(
  ctx: Context,
  files: readonly string[],
  defaultConfig: Readonly<Record<string, unknown>>,
): Promise<number> {
  for (const name of UNREAD_CONFIG_FILES) {
    if (await ctx.fs.isRegularFile(path.join(ctx.cwd, name))) {
      ctx.stderr.write(
        `gate: temple-bar reads markdownlint settings only from ${CONFIG_FILES.join(" or ")} ` +
          `at the top of the repo: move the settings in ${name} there\n`,
      );
      return 2;
    }
  }

  try {
    let config: Configuration = { ...defaultConfig };
    for (const name of CONFIG_FILES) {
      const file = path.join(ctx.cwd, name);
      if (await ctx.fs.isRegularFile(file)) {
        config = await readConfig(file, [parseJsonc]);
        break;
      }
    }
    const absolute = files.map((file) => path.join(ctx.cwd, file));
    const results = await lint({ files: absolute, config });
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
