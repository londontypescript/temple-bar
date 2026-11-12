// What the gate says about a `lint` script that lets warnings pass: the
// manifest, the script, the tool and the flag to add, so the fix is plain
// from the message alone (see lint-warnings.ts for how a script is read).

import {
  DENY_WARNINGS_FLAG,
  type LintFinding,
  type LintTool,
} from "./lint-warnings.ts";

function flagsOf(tools: readonly LintTool[]): string {
  return tools
    .map((tool) => `each ${tool} call with ${DENY_WARNINGS_FLAG[tool]}`)
    .join(", ");
}

/** The gate's message for `findings` in the manifest at `label`. */
export function formatLintFindings(
  label: string,
  findings: readonly LintFinding[],
  name = "lint",
): string {
  const lines = [
    `gate: ${label} has a "${name}" script that lets warnings pass`,
  ];
  for (const finding of findings) {
    switch (finding.kind) {
      case "no-flag": {
        const where = finding.from === name ? "" : ` (in "${finding.from}")`;
        const flag = DENY_WARNINGS_FLAG[finding.tool];
        lines.push(
          `  "${finding.command}"${where} runs ${finding.tool} without ${flag}: add ${flag} to it`,
        );
        break;
      }
      case "unreadable":
        lines.push(
          `  it calls ${finding.tools.join(", ")}, but the gate can't read it: ${finding.reason}`,
          `  write it as plain commands joined by "&&", ${flagsOf(finding.tools)}`,
        );
        break;
      case "too-deep":
        lines.push(
          `  it reaches ${finding.tool} too deep, through ${finding.chain.map((script) => `"${script}"`).join(" > ")}`,
          `  call ${finding.tool} from "${name}" or a script "${name}" runs directly, with ${DENY_WARNINGS_FLAG[finding.tool]}`,
        );
        break;
    }
  }
  return `${lines.join("\n")}\n`;
}
