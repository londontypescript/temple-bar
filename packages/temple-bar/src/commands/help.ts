import type { Context } from "../context.ts";
import { buildUsage, type CommandRegistry } from "../registry.ts";

/** `temple-bar help` (and the `--help`/`-h` aliases): usage to stdout, exit 0. */
export function helpCommand(
  registry: CommandRegistry,
  ctx: Context,
): Promise<number> {
  ctx.stdout.write(buildUsage(registry));
  return Promise.resolve(0);
}
