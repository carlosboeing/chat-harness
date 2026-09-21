import test from "node:test";
import assert from "node:assert/strict";

import { extractEvidence } from "../capabilities/private-health-qch/handler.mjs";

test("extracts internally consistent target quote evidence", () => {
  const body = `
    Cover Selector - Review
    Signature Hospital (Silver+) $62.06
    Select Extras $17.55
    79.61 Payment frequency Weekly
    Government Rebate of 24.118%
    Age based discount of 0%
    Lifetime Health Cover loading of 0%
  `;

  const result = extractEvidence(
    body,
    "Signature Hospital (Silver+)",
    "Select Extras",
  );

  assert.equal(result.hospital_product_found, true);
  assert.equal(result.extras_product_found, true);
  assert.deepEqual(result.quote_summary, {
    hospital_price: 62.06,
    extras_price: 17.55,
    combined_price: 79.61,
  });
  assert.equal(result.rebate_percent, 24.118);
});

test("rejects inconsistent combined quote evidence", () => {
  const body = `
    Signature Hospital (Silver+) $62.06
    Select Extras $17.55
    99.99 Payment frequency Weekly
  `;

  const result = extractEvidence(
    body,
    "Signature Hospital (Silver+)",
    "Select Extras",
  );

  assert.equal(result.quote_summary, null);
});
