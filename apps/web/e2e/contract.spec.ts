import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { expect, test } from "@playwright/test";
import { contractSamples, defaultScenario } from "./support/fixtures";

/**
 * The fixtures the UI suite serves must satisfy the gateway's published response contract
 * (docs/api/ui-contract.json, generated from the gateway's own types). If the gateway changes a
 * response shape, the contract file changes with it and these samples fail until updated, so the
 * UI tests can no longer pass against a shape the gateway does not produce.
 */
const contractPath = fileURLToPath(new URL("../../../docs/api/ui-contract.json", import.meta.url));
const contract = JSON.parse(readFileSync(contractPath, "utf8")) as { endpoints: Record<string, object> };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
// Numeric formats emitted by the schema generator, checked as real integer ranges.
const integerFormat = (min: number, max: number) => ({
  type: "number" as const,
  validate: (value: number) => Number.isInteger(value) && value >= min && value <= max,
});
ajv.addFormat("int16", integerFormat(-32768, 32767));
ajv.addFormat("uint", integerFormat(0, Number.MAX_SAFE_INTEGER));
ajv.addFormat("uint64", integerFormat(0, Number.MAX_SAFE_INTEGER));
ajv.addFormat("int64", integerFormat(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));

// Pure data checks: run once rather than per browser project.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "contract checks do not depend on a browser");
});

const samples = contractSamples(defaultScenario());

test("every contract endpoint has a fixture sample", () => {
  expect(Object.keys(samples).sort()).toEqual(Object.keys(contract.endpoints).sort());
});

for (const [endpoint, schema] of Object.entries(contract.endpoints)) {
  test(`fixture for ${endpoint} satisfies the gateway contract`, () => {
    const validate = ajv.compile(schema);
    const ok = validate(samples[endpoint]);
    expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
    expect(ok).toBe(true);
  });
}

test("the validator rejects a response that drifts from the contract", () => {
  const validate = ajv.compile(contract.endpoints["GET /wallet-transfers/pending"]);
  const drifted = { ...(samples["GET /wallet-transfers/pending"] as object), total: "many" };
  expect(validate(drifted)).toBe(false);
  const missing = { ...(samples["GET /wallet-transfers/pending"] as Record<string, unknown>) };
  delete missing.approvableCount;
  expect(validate(missing)).toBe(false);
});
