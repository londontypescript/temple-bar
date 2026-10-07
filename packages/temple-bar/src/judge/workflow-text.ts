// The pieces every workflow setup writes shares: the actions it uses, pinned
// once here, the Node version, and how its comments are laid out. One copy
// of each, so the judge, gate and title workflows can't drift apart.

// Each action is pinned to a full commit hash, the same one temple-bar's own
// CI uses: a tag can be moved to other code, a hash can't.
export const CHECKOUT =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7";
export const SETUP_NODE =
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7";
export const SETUP_PNPM =
  "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6";

/** The Node major version every workflow setup writes runs on. */
export const NODE_VERSION = 24;

/** A GitHub Actions expression, `${{ inner }}`. Built here so the workflow
 * templates never write the `\$` escape, which CodeQL takes for an escape in
 * a regular expression and flags. */
export function githubExpression(inner: string): string {
  return "$" + `{{ ${inner} }}`;
}

/** `text` as YAML comment lines, wrapped by word to fit 78 columns, the way
 * hand-written workflow comments are. */
export function yamlComment(text: string): string {
  const lines: string[] = [];
  let line = "#";
  for (const word of text.split(" ")) {
    if (line.length + 1 + word.length > 78 && line !== "#") {
      lines.push(line);
      line = "#";
    }
    line += ` ${word}`;
  }
  lines.push(line);
  return lines.join("\n");
}
