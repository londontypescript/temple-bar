// The oldest Node temple-bar runs on, and the message for one that is older.
// Kept in a file of its own, written in syntax even Node 14 can parse, so
// the entry points can load it and give a clear answer instead of a syntax
// error. It is not the Node CI uses (`NODE_VERSION` in judge/workflow-text.ts):
// that is the one version CI tests on, this is the floor users may run.
// The launcher package keeps its own copy, since it can't import this one;
// each package's test pins its copy to its own `engines.node`.

export const MIN_NODE_MAJOR = 24;

/** The text to print when `version` (such as "22.1.0") is older than the
 * minimum, or undefined when it is new enough or can't be read. `execPath`
 * is the node binary that is running, so the reader can tell which of
 * several installed Nodes was picked. */
export function nodeTooOldMessage(
  version: string,
  execPath: string,
): string | undefined {
  const major = parseInt(version.replace(/^v/, ""), 10);
  if (Number.isNaN(major) || major >= MIN_NODE_MAJOR) {
    return undefined;
  }
  return (
    `temple-bar needs Node ${String(MIN_NODE_MAJOR)} or newer, but this is Node ${version} (${execPath}). Nothing was changed.\n` +
    "\n" +
    `Fix: give the tool that ran this command (your terminal, editor or desktop app) a Node ${String(MIN_NODE_MAJOR)} or newer on its PATH.\n` +
    "A desktop app has to be restarted to pick up a new PATH.\n"
  );
}
