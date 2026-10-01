// Maps a subcommand name to a Command and dispatches to it. This is the only
// file that needs editing to register a new top-level command; the usage
// text is derived from what's registered (registry.ts), and the dispatch
// logic below never changes for a new command.

import type { Context } from "./context.ts";
import { helpCommand } from "./commands/help.ts";
import { versionCommand } from "./commands/version.ts";
import { gateCommand } from "./gate/command.ts";
import { createHookCommand } from "./hooks/command.ts";
import { installHooks } from "./hooks/install.ts";
import { readRealStdin } from "./hooks/stdin.ts";
import { createInitCommand } from "./init/command.ts";
import { leftoversCommandEntry } from "./leftovers/command.ts";
import { createMergeCommand, realMergeDeps } from "./merge/command.ts";
import { prSizeCommandEntry } from "./pr/command.ts";
import { prTitleCommand } from "./pr/title-command.ts";
import { buildCommandHelp, buildUsage, CommandRegistry } from "./registry.ts";

// Flags that mean the same thing as a registered command name.
const ALIASES: Readonly<Record<string, string>> = {
  "-h": "help",
  "--help": "help",
  "--version": "version",
};

// Asking any command for help shows its help and runs nothing (decision
// 20). Checked here, once, so no command can forget it and do its real work
// instead: `temple-bar gate --help` used to run the whole gate.
const HELP_FLAGS = new Set(["--help", "-h"]);

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

  registry.register(createInitCommand({ installHooks }));
  registry.register(gateCommand);
  registry.register(createHookCommand(readRealStdin));
  registry.register(createMergeCommand(realMergeDeps));
  registry.register(leftoversCommandEntry);
  registry.register(prSizeCommandEntry);
  registry.register(prTitleCommand);

  return registry;
}

/**
 * Dispatches `argv` (i.e. `process.argv.slice(2)`) to the matching command
 * and returns the process exit code. No arguments: usage to stderr, exit 2.
 * Unknown subcommand: usage plus "unknown command: <name>" to stderr, exit 2,
 * and nothing else happens (F12 / P8.2: an unrecognised command must not
 * write anything). `--help` or `-h` anywhere after a known command prints
 * that command's help to stdout, exits 0, and never runs the command.
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

  if (rest.some((arg) => HELP_FLAGS.has(arg))) {
    ctx.stdout.write(buildCommandHelp(entry));
    return 0;
  }

  return entry.run(rest, ctx);
}
