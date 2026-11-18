// Checks that the GitHub repository's About text is the README's one-line
// description, word for word: the first sentence of the paragraph the README
// opens with, under its header band. The other copies of that sentence are checked
// offline by package-metadata.test.ts; this one lives on GitHub, so CI runs
// this script with its token:
//
//   node scripts/check-about.ts
//
// It reads the repository from GITHUB_REPOSITORY ("owner/name"), as Actions
// sets it, and the token from GH_TOKEN.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Whether the lines between a band's `<p>` and `</p>` are a real picture:
 * an opening `<picture>`, an `<img`, and a closing `</picture>`, with no
 * HTML comment, which could hide any of them from the page. */
function isBand(inside: readonly string[]): boolean {
  const has = (pattern: RegExp) => inside.some((line) => pattern.test(line));
  return (
    has(/^\s*<picture>\s*$/) &&
    has(/^\s*<img\s/) &&
    has(/^\s*<\/picture>\s*$/) &&
    !inside.some((line) => line.includes("<!--"))
  );
}

/** The README's opening paragraph: its lines joined by spaces, and where it
 * sits, from its first line (`start`) to the blank line or end of file
 * after it (`end`, exclusive), as indices into the README's lines. It is
 * the first block of text after an optional header band (a `<p>` block
 * holding a `<picture>`), with no title before it. Undefined when the
 * README opens with anything else, such as a heading (an underlined one
 * too), a quote or a list: then there is no plain paragraph to read the
 * description from. */
export function readmeOpeningBlock(
  readme: string,
):
  | { readonly text: string; readonly start: number; readonly end: number }
  | undefined {
  const lines = readme.replaceAll("\r\n", "\n").split("\n");
  let start = 0;
  if (lines[0]?.trim() === "<p>") {
    const close = lines.findIndex((line) => line.trim() === "</p>");
    if (close < 0 || !isBand(lines.slice(1, close))) {
      return undefined;
    }
    start = close + 1;
  }
  while (lines[start]?.trim() === "") {
    start += 1;
  }
  let end = start;
  while (end < lines.length && lines[end]?.trim() !== "") {
    end += 1;
  }
  const paragraph = lines.slice(start, end).map((line) => line.trim());
  // A line of only = or - under text makes the text a heading.
  if (paragraph.slice(1).some((line) => /^(=+|-+)$/.test(line))) {
    return undefined;
  }
  const text = paragraph.join(" ");
  if (text === "" || /^[#>*<|`-]/.test(text)) {
    return undefined;
  }
  return { text, start, end };
}

/** The README's opening paragraph, its lines joined by spaces; undefined
 * when it doesn't open with one (see readmeOpeningBlock). */
function readmeOpening(readme: string): string | undefined {
  return readmeOpeningBlock(readme)?.text;
}

/** The README's one-line description: the first sentence of its opening
 * paragraph, up to and including the first full stop followed by a space
 * or the paragraph's end; undefined when there's no opening paragraph or
 * it has no full stop. */
export function readmeDescription(readme: string): string | undefined {
  const opening = readmeOpening(readme);
  const end = opening === undefined ? null : /\.(?= |$)/.exec(opening);
  return end === null ? undefined : opening?.slice(0, end.index + 1);
}

/** What's wrong, in words a maintainer can act on; undefined when the About
 * text matches. */
export function aboutProblem(
  readme: string,
  about: string | null | undefined,
): string | undefined {
  const description = readmeDescription(readme);
  if (description === undefined) {
    return "README.md doesn't open with a plain paragraph (after the header band, with no title) whose first sentence is the one-line description, so there is nothing to compare the About text with.";
  }
  if (about === description) {
    return undefined;
  }
  return [
    "The repository's About text differs from the first sentence of README.md's opening paragraph.",
    `  About:  ${about ?? "(none)"}`,
    `  README: ${description}`,
    "Set the About text to the README's first sentence (gh repo edit --description), or change every copy together.",
  ].join("\n");
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (repository === undefined || repository === "" || token === undefined) {
    console.error(
      "check-about: needs GITHUB_REPOSITORY (owner/name) and GH_TOKEN, as CI sets them.",
    );
    process.exit(2);
  }
  const response = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    console.error(
      `check-about: could not read ${repository} from GitHub: HTTP ${String(response.status)}.`,
    );
    process.exit(1);
  }
  const { description } = (await response.json()) as {
    description?: string | null;
  };
  const repoRoot = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const problem = aboutProblem(
    readFileSync(path.join(repoRoot, "README.md"), "utf8"),
    description,
  );
  if (problem !== undefined) {
    console.error(problem);
    process.exit(1);
  }
  console.log(
    "check-about: the About text matches README.md's one-line description.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
