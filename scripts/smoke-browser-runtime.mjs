import assert from "node:assert/strict";
import { withBrowserTask } from "../src/browser-runtime.mjs";

const execution = await withBrowserTask(
  {
    allowedHosts: ["example.invalid"],
    locale: "en-AU",
    timezoneId: "Australia/Brisbane",
    maxActions: 3,
  },
  async ({ page, step }) => {
    await step("render-local-fixture", () =>
      page.setContent(
        "<main><h1 id=\"status\">browser-runtime-ok</h1></main>",
      ),
    );

    return await step("extract-local-fixture", () =>
      page.locator("#status").innerText(),
    );
  },
);

assert.equal(execution.result, "browser-runtime-ok");
assert.equal(execution.diagnostics.execution, "playwright");
assert.equal(execution.diagnostics.browser, "chromium");
assert.equal(execution.diagnostics.steps, 2);

process.stdout.write(
  JSON.stringify(
    {
      state: "BROWSER_RUNTIME_OK",
      diagnostics: execution.diagnostics,
    },
    null,
    2,
  ) + "\n",
);
