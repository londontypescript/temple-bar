// A public Knip reporter captures evidence alongside its native reporter.
// It never changes findings, counters, or the project's preprocessors.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ReporterOptions } from "knip";

export function unusedReporterPath(): string {
  return fileURLToPath(import.meta.url);
}

export default function captureUnusedReport(data: ReporterOptions): void {
  const options: unknown = JSON.parse(data.options);
  if (
    typeof options !== "object" ||
    options === null ||
    !("outputPath" in options) ||
    typeof options.outputPath !== "string"
  ) {
    throw new Error("Missing gate-owned Knip report path");
  }
  writeFileSync(
    options.outputPath,
    JSON.stringify({
      report: data.report,
      issues: data.issues,
      counters: data.counters,
      hasConfigLoadErrors: data.hasConfigLoadErrors,
      configurationHintCount: data.configurationHints.length,
      tagHintCount: data.tagHints.size,
      isTreatConfigHintsAsErrors: data.isTreatConfigHintsAsErrors,
      isTreatTagHintsAsErrors: data.isTreatTagHintsAsErrors,
    }),
    { flag: "wx" },
  );
}
