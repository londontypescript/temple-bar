// The command registry: the one list a later subtask edits to add `gate`
// (1.6), `init` (1.7) or `hook <name>` (1.5). Each adds its own command
// module under its own folder and registers it with one line in router.ts;
// nothing here or in the usage text names a specific command.

import type { Context } from "./context.ts";

type Command = (args: readonly string[], ctx: Context) => Promise<number>;

export interface CommandEntry {
  readonly name: string;
  readonly summary: string;
  /** What follows the command name on its usage line, e.g. "<state>". */
  readonly args?: string;
  /** Extra paragraphs for `temple-bar <name> --help`, after the summary. */
  readonly details?: string;
  readonly run: Command;
}

export class CommandRegistry {
  readonly #entries = new Map<string, CommandEntry>();

  register(entry: CommandEntry): void {
    if (this.#entries.has(entry.name)) {
      throw new Error(`command "${entry.name}" is already registered`);
    }
    this.#entries.set(entry.name, entry);
  }

  get(name: string): CommandEntry | undefined {
    return this.#entries.get(name);
  }

  list(): readonly CommandEntry[] {
    return [...this.#entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}

export function buildUsage(registry: CommandRegistry): string {
  const lines = ["Usage: temple-bar <command> [options]", "", "Commands:"];
  for (const entry of registry.list()) {
    lines.push(`  ${entry.name.padEnd(10)} ${entry.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

/** "Usage: temple-bar <name> [args]", the first line of a command's help. */
export function formatUsageLine(name: string, args?: string): string {
  return `Usage: temple-bar ${name}${args === undefined ? "" : ` ${args}`}`;
}

/** What `temple-bar <name> --help` prints: usage line, summary, details. */
export function buildCommandHelp(entry: CommandEntry): string {
  const parts = [formatUsageLine(entry.name, entry.args), entry.summary];
  if (entry.details !== undefined) {
    parts.push(entry.details);
  }
  return `${parts.join("\n\n")}\n`;
}
