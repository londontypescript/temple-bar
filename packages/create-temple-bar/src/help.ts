// Help text for the launcher. Shown for --help / -h, before anything else
// happens, so asking for help never changes the project.

export const HELP_TEXT = `Usage: pnpm create @londontypescript/temple-bar@latest

temple-bar needs pnpm: https://pnpm.io/installation

Sets up temple-bar in the current project: adds @londontypescript/temple-bar
as a dev dependency, pinned to this launcher's own version, runs
\`pnpm install --frozen-lockfile\`, then \`temple-bar init\`.

Installation runs project lifecycle scripts, including framework preparation,
unless your pnpm settings disable them. In a workspace, pnpm installs the
workspace and runs its lifecycle scripts.

Run it from your project's root folder.

Options:
  --create-repo     The user already said yes to creating the GitHub
                    repository (passed on to \`temple-bar init\`)
  --create-ruleset  The user already said yes to creating the \`main\`
                    ruleset (passed on to \`temple-bar init\`)
  -h, --help        Show this help and change nothing

An agent passes a flag only after the user said yes in chat.
`;

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
