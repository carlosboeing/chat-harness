import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSnippet,
  isAllowedTopLevelUrl,
} from "../capabilities/private-health-qch/hospital-handler.mjs";

test("allows only Queensland Country top-level hospital search hosts", () => {
  assert.equal(
    isAllowedTopLevelUrl(
      "https://www.queenslandcountry.health/provider-search/hospital-search-page/",
    ),
    true,
  );
  assert.equal(isAllowedTopLevelUrl("https://example.com/"), false);
});

test("extracts evidence around the requested hospital", () => {
  const body =
    "Hospitals Other content Buderim Private Hospital 12 Example Street Buderim QLD More content";
  const snippet = extractSnippet(body, "Buderim Private Hospital");
  assert.match(snippet, /Buderim Private Hospital/);
  assert.match(snippet, /Example Street/);
});
