// Declares the Node temple-bar needs in the project's `engines.node`, so the
// requirement is machine-readable (package managers, hosting and editors
// read it). Like the rest of setup it only adds: a missing declaration is
// written, a plain `>=` below the minimum (Astro's scaffold writes
// `>=22.12.0`) is raised, and anything else is left alone and fails the
// run: a range this file can't compare may exclude Node 24 (`^22` does), so
// it's the project's to correct.

import { MIN_NODE_MAJOR } from "../node-version.ts";
import { RERUN_INIT } from "./requirements.ts";

export type NodeEnginesStep =
  | { readonly kind: "ok" }
  | { readonly kind: "added" }
  | { readonly kind: "raised"; readonly from: string }
  | { readonly kind: "problem"; readonly message: string };

export const WANTED_NODE = `>=${String(MIN_NODE_MAJOR)}`;

/** A plain lower bound: `>=22`, `>=22.12` or `>=22.12.0`, nothing else. */
const PLAIN_AT_LEAST = /^>=\s*(\d+)(?:\.\d+){0,2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Works out what setup does about `engines.node` and applies it to `pkg`
 * (the parsed package.json) when it adds or raises the declaration.
 */
export function declareNode(pkg: Record<string, unknown>): NodeEnginesStep {
  if (!Object.hasOwn(pkg, "engines")) {
    pkg.engines = { node: WANTED_NODE };
    return { kind: "added" };
  }
  const engines = pkg.engines;
  if (!isRecord(engines)) {
    return problem(
      `package.json's engines is ${JSON.stringify(engines)}, not an object`,
    );
  }
  if (!Object.hasOwn(engines, "node")) {
    engines.node = WANTED_NODE;
    return { kind: "added" };
  }
  const declared = engines.node;
  if (typeof declared !== "string") {
    return problem(
      `package.json's engines.node is ${JSON.stringify(declared)}, not a string`,
    );
  }
  const major = PLAIN_AT_LEAST.exec(declared.trim())?.[1];
  if (major === undefined) {
    return problem(
      `package.json's engines.node is ${JSON.stringify(declared)}, a range setup can't compare with ${WANTED_NODE}`,
    );
  }
  if (Number(major) >= MIN_NODE_MAJOR) {
    return { kind: "ok" };
  }
  engines.node = WANTED_NODE;
  return { kind: "raised", from: declared };
}

function problem(found: string): NodeEnginesStep {
  return {
    kind: "problem",
    message:
      `${found}, so it was left alone and couldn't be checked. temple-bar ` +
      `needs Node ${String(MIN_NODE_MAJOR)} or newer. Fix: set engines.node ` +
      `to "${WANTED_NODE}", then run ${RERUN_INIT} again.`,
  };
}
