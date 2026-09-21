import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLookupUrl,
  extractSnippet,
  htmlToText,
} from "../capabilities/private-health-qch/hospital-handler.mjs";

test("builds a bounded Queensland Country hospital lookup URL", () => {
  const url = buildLookupUrl("Buderim Private Hospital");
  assert.equal(url.hostname, "www.queenslandcountry.health");
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("name"), "Buderim Private Hospital");
  assert.equal(url.searchParams.get("gps"), "0");
});

test("extracts evidence around the requested hospital", () => {
  const html =
    "<main><h1>Hospitals</h1><div>Buderim Private Hospital</div><div>12 Example Street Buderim QLD</div></main>";
  const text = htmlToText(html);
  const snippet = extractSnippet(text, "Buderim Private Hospital");
  assert.match(snippet, /Buderim Private Hospital/);
  assert.match(snippet, /Example Street/);
});
