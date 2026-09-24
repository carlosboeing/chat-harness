import { describe, expect, test } from "bun:test";

import { validateScenarioCatalog } from "../../scripts/validate-evals.js";

describe("behavioural scenario catalog", () => {
  test("has valid shapes, unique ids, and existing fixtures", async () => {
    expect(await validateScenarioCatalog()).toEqual([]);
  });
});
