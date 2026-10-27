// The gate's options. Exactly three forms are accepted, and anything else is
// refused rather than ignored, so a typo can never quietly run the whole
// gate when one part was meant, or the reverse:
//
//   (none)                                         the whole gate
//   --part <name> --leg <leg> --report <file>      one part, with its report
//   --verify-parts <folder> --leg <leg>            check a leg's reports
//
// Each option takes its value as the next argument, once, in any order.

export type GateMode =
  | { readonly kind: "whole" }
  | {
      readonly kind: "part";
      readonly part: string;
      readonly leg: string;
      readonly report: string;
    }
  | { readonly kind: "verify"; readonly folder: string; readonly leg: string };

const OPTIONS = ["--part", "--leg", "--report", "--verify-parts"] as const;
type Option = (typeof OPTIONS)[number];

function isOption(arg: string): arg is Option {
  return (OPTIONS as readonly string[]).includes(arg);
}

/** The mode `args` asks for, or why they are refused. */
export function parseGateArgs(args: readonly string[]): GateMode | string {
  const given = new Map<Option, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!isOption(arg)) {
      return arg.startsWith("-")
        ? `unknown option: ${arg}`
        : `unexpected argument: ${arg}`;
    }
    if (given.has(arg)) {
      return `${arg} is given more than once`;
    }
    // A value that looks like an option is a forgotten value, not a name.
    const value = args[index + 1];
    if (value === undefined || value === "" || value.startsWith("-")) {
      return `${arg} needs a value`;
    }
    given.set(arg, value);
    index += 1;
  }

  const part = given.get("--part");
  const folder = given.get("--verify-parts");
  const leg = given.get("--leg");
  const report = given.get("--report");
  if (part !== undefined && folder !== undefined) {
    return "--part and --verify-parts can't be used together";
  }
  if (part !== undefined) {
    if (leg === undefined) {
      return "--part needs --leg";
    }
    if (report === undefined) {
      return "--part needs --report";
    }
    return { kind: "part", part, leg, report };
  }
  if (folder !== undefined) {
    if (report !== undefined) {
      return "--report is only for --part";
    }
    if (leg === undefined) {
      return "--verify-parts needs --leg";
    }
    return { kind: "verify", folder, leg };
  }
  if (leg !== undefined) {
    return "--leg needs --part or --verify-parts";
  }
  if (report !== undefined) {
    return "--report needs --part";
  }
  return { kind: "whole" };
}
