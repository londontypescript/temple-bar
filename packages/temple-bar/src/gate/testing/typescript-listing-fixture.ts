// A repo whose tsc is faked, for the tests of the coverage check's
// TypeScript listings: a tsc that answers each call as a test chooses, the
// root's listing context, and ways to read what was asked and what
// failed. Not shipped: the build tsconfig excludes every `testing/` folder.

import path from "node:path";

import {
  createFakeContext,
  createFakeFs,
  createFakeProc,
  createFakeWriter,
  type FakeProc,
} from "../../testing/fakes.ts";
import { createListings, type Listing } from "../coverage-listing.ts";
import { PNPM_EXEC } from "./workspace-fixture.ts";

export interface Reply {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** tsc's arguments in a call made through pnpm's exec. */
function tscArgs(args: readonly string[]): readonly string[] {
  return args.slice(args.indexOf("exec") + 2);
}

/** A repo at /repo holding `files`, whose tsc answers `reply`. */
export function repo(
  files: Readonly<Record<string, string>>,
  reply: (args: readonly string[]) => Reply,
) {
  const fs = createFakeFs({ "/repo/package.json": "{}", ...files });
  const proc = createFakeProc((call, run) => {
    const answer = reply(tscArgs(call.args));
    run.stdout.write(answer.stdout ?? "");
    run.stderr.write(answer.stderr ?? "");
    return answer.code ?? 0;
  });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    fs,
    proc,
    stdout,
    stderr,
    env: { npm_execpath: PNPM_EXEC },
  });
  return { ctx, fs, proc, stdout, stderr };
}

/** The listing context of the root's typecheck script, `tsc -b`. */
export async function rootListing(
  ctx: ReturnType<typeof repo>["ctx"],
  platform: NodeJS.Platform = process.platform,
) {
  const listingsFor = await createListings(
    ctx,
    { kind: "javascript", path: PNPM_EXEC },
    undefined,
    platform,
  );
  return listingsFor({
    folder: "/repo",
    realFolder: path.normalize("/repo"),
    where: "the root",
    script: "typecheck",
    command: "tsc -b",
  });
}

/** tsc's calls with `flag` among their arguments, each joined. */
export function calls(proc: FakeProc, flag: string): string[] {
  return proc.calls
    .map((call) => tscArgs(call.args))
    .filter((args) => args.includes(flag))
    .map((args) => args.join(" "));
}

/** Why the first of `listings` failed, if it did. */
export function failureOf(listings: readonly Listing[]): string | undefined {
  const [first] = listings;
  return first !== undefined && "failure" in first ? first.failure : undefined;
}

/** A config's --showConfig output, with these references. */
export function showing(...references: string[]): Reply {
  return {
    stdout: JSON.stringify({
      compilerOptions: {},
      references: references.map((reference) => ({ path: reference })),
    }),
  };
}

/** Four configs on disk for `tsc -b` to reach. */
export const PROJECTS = {
  "/repo/tsconfig.json": "",
  "/repo/a.json": "",
  "/repo/b.json": "",
  "/repo/c/tsconfig.json": "",
};
