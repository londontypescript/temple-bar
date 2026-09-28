#!/usr/bin/env node

// Enforces the file-length cap. Runs unconditionally: an entry-point check
// that could silently skip would make the rule pass without checking.

import {
  collectLineCounts,
  findOverCapFiles,
  readMaxFileLines,
} from "./lengths.ts";

function main(): void {
  const cwd = process.cwd();
  const maxLines = readMaxFileLines(cwd);
  const entries = collectLineCounts(cwd);
  const offenders = findOverCapFiles(entries, maxLines);

  if (offenders.length === 0) {
    console.log(
      `All ${String(entries.length)} tracked text files are within the ${String(maxLines)}-line cap.`,
    );
    return;
  }

  console.error(
    `${String(offenders.length)} file(s) exceed the ${String(maxLines)}-line cap:`,
  );
  for (const offender of offenders) {
    console.error(`  ${offender.path}: ${String(offender.lines)} lines`);
  }
  process.exitCode = 1;
}

main();
