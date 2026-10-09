// Aliases for the older installation regressions, backed by authentic frozen
// published bytes shared with the complete historical upgrade regressions.
import { outputFromRelease } from "../../testing/published-output.ts";

export const PRE_COMMIT_SHIM_0_0_3 = outputFromRelease(
  "hooks/pre-commit",
  "0.0.3",
);
export const REFERENCE_TRANSACTION_SHIM_0_0_3 = outputFromRelease(
  "hooks/reference-transaction",
  "0.0.3",
);
export const POST_CHECKOUT_SHIM_0_0_7 = outputFromRelease(
  "hooks/post-checkout",
  "0.0.7",
);
