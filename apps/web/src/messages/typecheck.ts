// Compile-time checks for the catalog's typing. This file is never imported at run time; `tsc`
// (npm run lint) fails if any of these stops behaving as described, because an `@ts-expect-error`
// that no longer errors is itself an error.
import { t } from "./index.ts";

t("decision.approved");
t("dryRun.overPeriodLimit.description", { limit: "$1.00 USDC" });
t("dryRun.overTransactionLimit.description", { amount: 15, limit: "$10.00 USDC" });

// @ts-expect-error a message with a placeholder needs its parameters
t("dryRun.overPeriodLimit.description");
// @ts-expect-error every placeholder must be supplied
t("dryRun.overTransactionLimit.description", { amount: "$15.00 USDC" });
// @ts-expect-error a misspelled placeholder name is rejected
t("dryRun.overPeriodLimit.description", { limt: "$1.00 USDC" });
// @ts-expect-error unknown keys are rejected
t("decision.doesNotExist");
// @ts-expect-error messages without placeholders take no parameters
t("decision.approved", { extra: 1 });
