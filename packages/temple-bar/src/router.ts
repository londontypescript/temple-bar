// Maps a subcommand name to a Command and dispatches to it. This is the only
// file that needs editing to register a new top-level command: 1.5 adds
// `registry.register({ name: "hook", ... })` backed by src/hooks/, 1.6 adds
// `gate` backed by src/gate/, and 1.7 adds `init` backed by src/init/. None
// of them touch the usage text (registry.ts derives it from what's
// registered) or this file's dispatch logic.

import type { Context } from "./context.ts";
import { helpCommand } from "./commands/help.ts";
import { versionCommand } from "./commands/version.ts";
import { buildUsage, CommandRegistry } from "./registry.ts";

// Flags that mean the same thing as a registered command name.
const ALIASES: Readonly<Record<string, string>> = {
  "-h": "help",
  "--help": "help",
  "--version": "version",
};

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register({
    name: "help",
    summary: "Show usage.",
    run: (_args, ctx) => helpCommand(registry, ctx),
  });

  registry.register({
    name: "version",
    summary: "Print the installed version.",
    run: (_args, ctx) => versionCommand(ctx),
  });

  return registry;
}

/**
 * Dispatches `argv` (i.e. `process.argv.slice(2)`) to the matching command
 * and returns the process exit code. No arguments: usage to stderr, exit 2.
 * Unknown subcommand: usage plus "unknown command: <name>" to stderr, exit 2,
 * and nothing else happens (F12 / P8.2: an unrecognised command must not
 * write anything).
 */
export async function route(
  argv: readonly string[],
  ctx: Context,
  registry: CommandRegistry = createRegistry(),
): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined) {
    ctx.stderr.write(buildUsage(registry));
    return 2;
  }

  const name = ALIASES[first] ?? first;
  const entry = registry.get(name);

  if (!entry) {
    ctx.stderr.write(buildUsage(registry));
    ctx.stderr.write(`unknown command: ${first}\n`);
    return 2;
  }

  return entry.run(rest, ctx);
}
