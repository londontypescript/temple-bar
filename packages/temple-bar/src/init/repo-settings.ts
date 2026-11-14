// The repository's squash merge defaults: the commit a merge on the site
// suggests takes its title from the pull request's title and its body from
// the pull request's description. The `main` ruleset allows squash merges
// only, and with GitHub's own default the suggested body is the branch's
// commit messages instead, so a merge on the site can quietly drop the
// description's bullets and trailers. Setup sets these under the same yes
// as the rulesets, then reads them back: GitHub accepting the change isn't
// proof it took (ADR 0004, decision 40's list).

import type { Context } from "../context.ts";
import type { GithubOrigin } from "./requirements.ts";
import { field, readJson } from "./ruleset-update.ts";

const WANTED = {
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "PR_BODY",
} as const;

/** What the one question says the yes covers. */
export const SQUASH_DEFAULTS_SUMMARY =
  "set squash merges to default to the pull request's title and " +
  "description as the commit message";

const MANUAL_SETTINGS_STEP =
  "On GitHub, under Settings > General > Pull Requests, set the default " +
  'commit message for squash merging to "Default to pull request title ' +
  'and description".';

/** GitHub's own rule for owner and repository names. Anything else came
 * from an odd remote URL and isn't put in a command to paste. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** The manual step: where the setting is on the site, and the gh command
 * that sets both halves, for a user who declined or had no terminal. */
export function manualSquashDefaultsSteps(origin: GithubOrigin): string {
  if (!SAFE_NAME.test(origin.owner) || !SAFE_NAME.test(origin.repo)) {
    return MANUAL_SETTINGS_STEP;
  }
  const fields = Object.entries(WANTED)
    .map(([key, value]) => ` -f ${key}=${value}`)
    .join("");
  return (
    `${MANUAL_SETTINGS_STEP} Or run:\n` +
    `  gh api --method PATCH repos/${origin.owner}/${origin.repo}${fields}`
  );
}

export type SquashDefaults =
  | { readonly kind: "set" }
  /** What GitHub has now, as its API names it. */
  | {
      readonly kind: "differs";
      readonly title: string;
      readonly message: string;
    }
  /** The whole sentence to show: setup isn't finished. */
  | { readonly kind: "unreadable"; readonly message: string };

function unreadable(reason: string): SquashDefaults {
  return {
    kind: "unreadable",
    message:
      `Setup couldn't read the repository's squash merge settings, so it ` +
      `left them alone: ${reason}. Run setup again once GitHub answers.`,
  };
}

/** Reads the defaults without changing anything. A reply without both
 * fields as text is a failure, never taken to mean "not set". */
export async function readSquashDefaults(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<SquashDefaults> {
  const read = await readJson(
    ctx,
    repoRoot,
    `repos/${origin.owner}/${origin.repo}`,
  );
  if (!read.ok) {
    return unreadable(read.error);
  }
  const title = field(read.value, "squash_merge_commit_title");
  const message = field(read.value, "squash_merge_commit_message");
  if (typeof title !== "string" || typeof message !== "string") {
    return unreadable("no squash merge settings in the reply");
  }
  return title === WANTED.squash_merge_commit_title &&
    message === WANTED.squash_merge_commit_message
    ? { kind: "set" }
    : { kind: "differs", title, message };
}

/** Sets both defaults in one change, then reads them back. Anything but
 * both set afterwards fails, so setup ends "not finished". */
export async function setSquashDefaults(
  ctx: Context,
  repoRoot: string,
  origin: GithubOrigin,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const result = await ctx.gh.run(
    [
      "api",
      "--method",
      "PATCH",
      `repos/${origin.owner}/${origin.repo}`,
      "--input",
      "-",
    ],
    repoRoot,
    JSON.stringify(WANTED),
  );
  if (result.code !== 0) {
    return {
      ok: false,
      message: `setting the squash merge defaults failed:\n${(result.stderr || result.stdout).trim()}`,
    };
  }
  const after = await readSquashDefaults(ctx, repoRoot, origin);
  if (after.kind === "set") {
    return {
      ok: true,
      message:
        "Squash merges now default to the pull request's title and " +
        "description.",
    };
  }
  return {
    ok: false,
    message:
      "GitHub accepted the squash merge defaults, but reading them back " +
      (after.kind === "differs"
        ? `shows title ${after.title} and message ${after.message}`
        : `failed: ${after.message}`),
  };
}
