// The installed judge run on a pull request the fake GitHub API serves as two
// whole trees, for the packed tests that judge a project set up by the
// packed launcher.

import type { FakeFile } from "./fake-git-objects.ts";
import { serveFakeGithubApi } from "./fake-github-api.ts";
import { run, type RunOptions, type RunResult } from "./run.ts";

export type Files = Readonly<Record<string, FakeFile>>;

/** The pull request's number, for matching the judge's messages. */
export const PR = 7;

const BASE_SHA = "b".repeat(40);
const HEAD_SHA = "c".repeat(40);
const LATER_HEAD_SHA = "d".repeat(40);

/** What the judge prints when a pull request leaves the checks alone. */
export const PASSED = new RegExp(
  `pull request #${String(PR)} leaves the checks alone`,
);

export interface Serving {
  /** Which side's tree GitHub can't list whole. */
  readonly truncated?: "base" | "head";
  /** The head moves to a commit with the same files after the first read
   * of the pull request. */
  readonly headMoves?: boolean;
}

/** Runs the judge installed in `project` on a pull request from `base` to
 * `head`. */
export async function judgePullRequest(
  project: RunOptions,
  base: Files,
  head: Files,
  { truncated, headMoves = false }: Serving = {},
): Promise<RunResult> {
  const api = await serveFakeGithubApi(
    "acme",
    "widgets",
    [
      {
        number: PR,
        headShas: headMoves ? [HEAD_SHA, LATER_HEAD_SHA] : [HEAD_SHA],
        baseRef: "main",
        baseShas: [BASE_SHA],
      },
    ],
    {
      trees: {
        [BASE_SHA]: base,
        [HEAD_SHA]: head,
        [LATER_HEAD_SHA]: head,
      },
      branches: { main: [BASE_SHA] },
      truncated:
        truncated === undefined
          ? []
          : [truncated === "base" ? BASE_SHA : HEAD_SHA],
    },
  );
  try {
    // Not a GitHub Actions job, whatever runs this suite, and no real token
    // is ever sent to the fake API.
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        Object.entries(project.env).filter(
          ([name]) => !/^(GITHUB_ACTIONS|GH_TOKEN|GITHUB_TOKEN)$/.test(name),
        ),
      ),
      GITHUB_API_URL: api.url,
      GITHUB_REPOSITORY: "acme/widgets",
    };
    return await run(
      "pnpm",
      ["exec", "temple-bar", "judge", "--pr", String(PR)],
      { cwd: project.cwd, env },
    );
  } finally {
    await api.close();
  }
}
