import type { Context } from "../context.ts";
import { readOwnVersion } from "../package-info.ts";

/** `temple-bar version` (and the `--version` alias): prints the version, exit 0. */
export function versionCommand(ctx: Context): Promise<number> {
  ctx.stdout.write(`${readOwnVersion()}\n`);
  return Promise.resolve(0);
}
