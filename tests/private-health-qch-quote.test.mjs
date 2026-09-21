import test from "node:test";
import assert from "node:assert/strict";

import {
  extractQuoteFromText,
  validateInput,
} from "../capabilities/private-health-qch-quote/handler.mjs";

const validInput = {
  profile_ref: "synthetic-family-qld-v1",
  hospital_product: "Signature Hospital (Silver+)",
  extras_product: "Select Extras",
  excess: 750,
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

test("extracts a matching quote evidence line", () => {
  const text = [
    "Signature Hospital (Silver+)",
    "$750 excess",
    "Select Extras",
    "Your quote $412.34 per month",
  ].join("\n");

  assert.deepEqual(
    extractQuoteFromText(
      text,
      validInput.hospital_product,
      validInput.extras_product,
      validInput.excess,
    ),
    {
      product_match: true,
      excess_match: true,
      premium_amount: 412.34,
      frequency: "month",
      evidence_line: "Your quote $412.34 per month",
    },
  );
});

test("does not accept a premium without exact product evidence", () => {
  const text = "Different Hospital\nSelect Extras\n$300 per month";
  assert.equal(
    extractQuoteFromText(
      text,
      validInput.hospital_product,
      validInput.extras_product,
      validInput.excess,
    ),
    null,
  );
});
