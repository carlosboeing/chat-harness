import test from "node:test";
import assert from "node:assert/strict";

import {
  parseReviewEvidence,
  validateInput,
} from "../capabilities/private-health-qch-quote/handler.mjs";

const validInput = {
  profile_ref: "synthetic-family-qld-v1",
  hospital_product: "Signature Hospital (Silver+)",
  extras_product: "Select Extras",
  excess: 750,
  payment_frequency: "monthly",
};

test("accepts only the approved synthetic QCH quote contract", () => {
  assert.equal(validateInput(validInput).ok, true);

  const invalid = validateInput({
    ...validInput,
    profile_ref: "real-family",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "UNKNOWN_PROFILE");
});

test("rejects arbitrary input fields", () => {
  const invalid = validateInput({
    ...validInput,
    url: "https://attacker.example/",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "UNEXPECTED_INPUT");
});

test("rejects unregistered payment frequencies", () => {
  const invalid = validateInput({
    ...validInput,
    payment_frequency: "weekly",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "UNSUPPORTED_PAYMENT_FREQUENCY");
});

test("parses internally consistent exact review evidence", () => {
  const result = parseReviewEvidence({
    bodyText: [
      "Signature Hospital (Silver+) $269.00",
      "Select Extras $76.00",
      "Prices quoted reflect Government Rebate of 24.118%",
      "Age based discount of 0%",
      "Lifetime Health Cover loading of 0%",
    ].join("\n"),
    summaryText: "Family in QLD $345.00 Monthly with $750 hospital excess",
    selectedFrequency: "monthly",
    selectedExcess: true,
    combinedProductId: "FSG750LQ",
  });

  assert.deepEqual(result, {
    product_match: true,
    excess_match: true,
    payment_frequency_match: true,
    combined_product_id: "FSG750LQ",
    premium_amount: 345,
    frequency: "monthly",
    hospital_component: 269,
    extras_component: 76,
    government_rebate_percent: 24.118,
    age_based_discount_percent: 0,
    lifetime_health_cover_loading_percent: 0,
    evidence_summary: "Family in QLD $345.00 Monthly with $750 hospital excess",
  });
});

test("rejects inconsistent combined premium", () => {
  assert.equal(
    parseReviewEvidence({
      bodyText:
        "Signature Hospital (Silver+) $269.00\nSelect Extras $76.00",
      summaryText: "Family in QLD $999.00 Monthly with $750 hospital excess",
      selectedFrequency: "monthly",
      selectedExcess: true,
      combinedProductId: "FSG750LQ",
    }),
    null,
  );
});

test("rejects evidence when the requested excess is not selected", () => {
  assert.equal(
    parseReviewEvidence({
      bodyText:
        "Signature Hospital (Silver+) $269.00\nSelect Extras $76.00",
      summaryText: "Family in QLD $345.00 Monthly with $750 hospital excess",
      selectedFrequency: "monthly",
      selectedExcess: false,
      combinedProductId: "FSG750LQ",
    }),
    null,
  );
});
