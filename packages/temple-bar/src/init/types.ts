// Shared types for the `init` command. Kept separate from command.ts so
// requirements.ts, github-*.ts and files.ts can import them without a cycle
// through command.ts itself.

import type { Context } from "../context.ts";
import type { InstallReport } from "../hooks/install.ts";

export interface InitDeps {
  /** Writes the hook shims into the git folder every worktree shares and
   * sets pull.ff=only (hooks/install.ts in production; a fake in tests). */
  readonly installHooks: (
    ctx: Context,
    repoRoot: string,
  ) => Promise<InstallReport>;
}
