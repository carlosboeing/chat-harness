import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSnippet,
  isAllowedTopLevelUrl,
} from "../capabilities/private-health-medibank/provider-handler.mjs";

test("allows only Medibank top-level provider search hosts", () => {
  assert.equal(
    isAllowedTopLevelUrl("https://www.medibank.com.au/health-insurance/find-provider/"),
    true,
  );
  assert.equal(isAllowedTopLevelUrl("https://example.com/"), false);
});

test("extracts provider evidence", () => {
  const snippet = extractSnippet(
    "Dentist results Budi Dental Ballinger Road Buderim QLD 4556 Members Choice",
    "Budi Dental",
  );
  assert.match(snippet, /Budi Dental/);
  assert.match(snippet, /4556/);
});
