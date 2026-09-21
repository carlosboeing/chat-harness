import test from "node:test";
import assert from "node:assert/strict";

import {
  isAllowedTopLevelUrl,
  sanitizeUrl,
} from "../src/browser-runtime.mjs";

test("browser runtime allows only HTTPS top-level destinations on allowlist", () => {
  const allowed = ["example.com", "*.example.com"];

  assert.equal(isAllowedTopLevelUrl("https://example.com/a", allowed), true);
  assert.equal(isAllowedTopLevelUrl("https://www.example.com/a", allowed), true);
  assert.equal(isAllowedTopLevelUrl("http://example.com/a", allowed), false);
  assert.equal(isAllowedTopLevelUrl("https://example.net/a", allowed), false);
});

test("sanitizeUrl strips query and fragment data", () => {
  assert.equal(
    sanitizeUrl("https://example.com/quote?dob=secret#step2"),
    "https://example.com/quote",
  );
});
