import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEvidence,
  isAllowedTopLevelUrl,
} from "../capabilities/private-health-qch/handler.mjs";

test("allows only Queensland Country top-level quote hosts", () => {
  assert.equal(
    isAllowedTopLevelUrl("https://www.queenslandcountry.health/cover-selector-new/"),
    true,
  );
  assert.equal(
    isAllowedTopLevelUrl("https://queenslandcountry.health/cover-selector-new/"),
    true,
  );
  assert.equal(isAllowedTopLevelUrl("https://example.com/quote"), false);
  assert.equal(isAllowedTopLevelUrl("http://www.queenslandcountry.health/"), false);
});

test("extracts target product evidence and prices", () => {
  const body = `
    Signature Hospital (Silver+) Cover
    Select Extras
    Family premium $112.34 per week.
  `;

  const result = extractEvidence(
    body,
    "Signature Hospital (Silver+)",
    "Select Extras",
  );

  assert.equal(result.hospital_product_found, true);
  assert.equal(result.extras_product_found, true);
  assert.deepEqual(result.prices, ["$112.34"]);
});
