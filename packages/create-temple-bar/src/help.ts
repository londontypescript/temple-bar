// Help text for the launcher. Shown for --help / -h, before anything else
// happens, so asking for help never changes the project.

export const HELP_TEXT = `Usage: npm create @londontypescript/temple-bar@latest
       (pnpm create, yarn create and bun create work too)

Sets up temple-bar in the current project: adds @londontypescript/temple-bar
as a dev dependency, pinned to this launcher's own version, then runs
\`temple-bar init\`.

Run it from your project's root folder.

Options:
  -h, --help   Show this help and change nothing
`;

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
