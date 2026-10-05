// Checks that the GitHub repository's About text is the README's one-line
// description, word for word. The other copies of that sentence are checked
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

/** The README's description: its first line after the title, in bold;
 * undefined when that line isn't a bold line of its own. */
export function readmeDescription(readme: string): string | undefined {
  const firstLine = readme.replaceAll("\r\n", "\n").split("\n")[2] ?? "";
  return /^\*\*(.+)\*\*$/.exec(firstLine)?.[1];
}

/** What's wrong, in words a maintainer can act on; undefined when the About
 * text matches. */
export function aboutProblem(
  readme: string,
  about: string | null | undefined,
): string | undefined {
  const description = readmeDescription(readme);
  if (description === undefined) {
    return "README.md's first line after the title isn't the one-line description in bold, so there is nothing to compare the About text with.";
  }
  if (about === description) {
    return undefined;
  }
  return [
    "The repository's About text differs from README.md's first line.",
    `  About:  ${about ?? "(none)"}`,
    `  README: ${description}`,
    "Set the About text to the README's line (gh repo edit --description), or change every copy together.",
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
  console.log("check-about: the About text matches README.md's first line.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
