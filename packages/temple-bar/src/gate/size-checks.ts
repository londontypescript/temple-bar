// The gate's two size checks as outcomes: the file-length cap over every
// tracked text file (lengths.ts) and AGENTS.md's line and byte limits
// (agents-size.ts).

import type { Context } from "../context.ts";
import {
  checkAgentsSize,
  formatAgentsSizeFailure,
  AGENTS_FILE,
  AGENTS_MAX_BYTES,
  AGENTS_MAX_LINES,
} from "./agents-size.ts";
import { checkFileLengths, formatLengthFailure } from "./lengths.ts";
import type { CheckOutcome } from "./report.ts";

export const LENGTH_CHECK = "file-length cap";
export const AGENTS_SIZE_CHECK = "AGENTS.md size";

export async function runLengthCheck(ctx: Context): Promise<CheckOutcome> {
  const result = await checkFileLengths(ctx);
  const cap = `${String(result.maxLines)}-line cap`;
  if (result.offenders.length > 0) {
    ctx.stderr.write(formatLengthFailure(result));
    return {
      name: LENGTH_CHECK,
      status: "failed",
      detail: `${String(result.offenders.length)} file(s) over the ${cap}`,
    };
  }
  return {
    name: LENGTH_CHECK,
    status: "passed",
    detail: `all ${String(result.totalChecked)} tracked text file(s) are within the ${cap}`,
  };
}

export async function runAgentsSizeCheck(ctx: Context): Promise<CheckOutcome> {
  const result = await checkAgentsSize(ctx);
  if (!result.found) {
    // Setup writes AGENTS.md, but a docs-only or mid-setup repo may not have
    // one yet; absence is not an oversized file.
    return {
      name: AGENTS_SIZE_CHECK,
      status: "skipped",
      detail: `no ${AGENTS_FILE}`,
    };
  }
  if (result.overLines || result.overBytes) {
    ctx.stderr.write(formatAgentsSizeFailure(result));
    return {
      name: AGENTS_SIZE_CHECK,
      status: "failed",
      detail: `${String(result.lines)} lines, ${String(result.bytes)} bytes`,
    };
  }
  return {
    name: AGENTS_SIZE_CHECK,
    status: "passed",
    detail: `${String(result.lines)}/${String(AGENTS_MAX_LINES)} lines, ${String(result.bytes)}/${String(AGENTS_MAX_BYTES)} bytes`,
  };
}
