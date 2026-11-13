// `init`'s arguments, parsed strictly: anything it doesn't know is refused
// rather than ignored, so a typo can't quietly drop a yes, and an option's
// value can never be another option (`--owner --create-repo`).
//
//   --create-repo             the user said yes to creating the repository
//   --create-ruleset          the user said yes to the rulesets and CodeQL
//   --owner <organisation>    the user's answer: who owns the new repository
//   --identities <code>       the code of the commit identities they saw
//
// A value comes as the next argument or after `=`, once.

export interface InitArgs {
  readonly createRepo: boolean;
  readonly createRuleset: boolean;
  readonly owner: string | undefined;
  readonly identities: string | undefined;
}

/** A GitHub account name: letters, digits and hyphens, at most 39, never
 * starting or ending with a hyphen. So never a path (`org/name`) or an
 * option. Double hyphens are let through: some older names have them, and
 * GitHub itself says whether the account exists. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** The code setup prints for the identities it disclosed. */
const IDENTITIES_PATTERN = /^[0-9a-f]{12}$/;

const VALUE_OPTIONS = {
  "--owner": {
    pattern: OWNER_PATTERN,
    expected:
      "a GitHub organisation's name, such as `--owner londontypescript`",
  },
  "--identities": {
    pattern: IDENTITIES_PATTERN,
    expected: "the 12-character code setup printed with the identities",
  },
} as const;
type ValueOption = keyof typeof VALUE_OPTIONS;

function isValueOption(name: string): name is ValueOption {
  return Object.hasOwn(VALUE_OPTIONS, name);
}

/** The arguments `args` give, or why they are refused. */
export function parseInitArgs(args: readonly string[]): InitArgs | string {
  let createRepo = false;
  let createRuleset = false;
  const values = new Map<ValueOption, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--create-repo") {
      createRepo = true;
      continue;
    }
    if (arg === "--create-ruleset") {
      createRuleset = true;
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!isValueOption(name)) {
      return arg.startsWith("-")
        ? `unknown option: ${arg}`
        : `unexpected argument: ${arg}`;
    }
    if (values.has(name)) {
      return `${name} is given more than once`;
    }
    let value: string | undefined;
    if (equals === -1) {
      value = args[index + 1];
      index += 1;
    } else {
      value = arg.slice(equals + 1);
    }
    // A value that looks like an option is a forgotten value.
    if (value === undefined || value === "" || value.startsWith("-")) {
      return `${name} needs a value: ${VALUE_OPTIONS[name].expected}`;
    }
    if (!VALUE_OPTIONS[name].pattern.test(value)) {
      return `${name} ${JSON.stringify(value)} isn't ${VALUE_OPTIONS[name].expected}`;
    }
    values.set(name, value);
  }
  const owner = values.get("--owner");
  if (createRepo && owner === undefined) {
    return (
      "--create-repo needs --owner <organisation>: the GitHub organisation " +
      "the user agreed should own the new repository"
    );
  }
  return {
    createRepo,
    createRuleset,
    owner,
    identities: values.get("--identities"),
  };
}
