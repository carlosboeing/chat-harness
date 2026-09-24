import { describe, expect, test } from "bun:test";

import {
  isAllowedTopLevelUrl,
  sanitizeUrl,
} from "../../../extensions/github/browser-runtime.js";

describe("browser runtime policy", () => {
  test("allows only HTTPS top-level hosts in the explicit allowlist", () => {
    expect(isAllowedTopLevelUrl("https://example.com/path", ["example.com"])).toBe(true);
    expect(isAllowedTopLevelUrl("https://a.example.com/path", ["*.example.com"])).toBe(true);
    expect(isAllowedTopLevelUrl("https://example.com/path", ["*.example.com"])).toBe(false);
    expect(isAllowedTopLevelUrl("http://example.com/path", ["example.com"])).toBe(false);
    expect(isAllowedTopLevelUrl("https://example.net/path", ["example.com"])).toBe(false);
    expect(isAllowedTopLevelUrl("about:blank", ["example.com"])).toBe(true);
  });

  test("sanitizes diagnostic URLs without query or fragment and preserves about:blank", () => {
    expect(sanitizeUrl("https://example.com/a?token=secret#fragment")).toBe(
      "https://example.com/a",
    );
    expect(sanitizeUrl("about:blank")).toBe("about:blank");
  });
});
