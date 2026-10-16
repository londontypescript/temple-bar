// The global git config for every isolated environment the tests and the
// scaffold check give git.
//
// After a commit, a fetch or a push, git starts its automatic maintenance in
// the background, and it can outlive the command. A test that deletes its
// repository straight away then races it: git recreates the folders it
// writes to, and the temp-folder check fails the file for the leftover.
export const QUIET_GIT_CONFIG =
  "[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n";
