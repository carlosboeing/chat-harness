import {
  isAllowedTopLevelUrl,
  withBrowserTask,
} from "../extensions/github/browser-runtime.js";

if (!isAllowedTopLevelUrl("https://example.com", ["example.com"])) {
  throw new Error("allowlist rejected expected host");
}
if (isAllowedTopLevelUrl("https://example.net", ["example.com"])) {
  throw new Error("allowlist accepted unexpected host");
}

const output = await withBrowserTask(
  {
    allowedHosts: ["example.com"],
    maxActions: 4,
  },
  async ({ page, step }) => {
    await step("fixture", async () => {
      await page.setContent("<main><h1>Browser runtime fixture</h1></main>");
    });
    const heading = await step("read", () => page.locator("h1").innerText());
    return { heading };
  },
);

if (output.result.heading !== "Browser runtime fixture") {
  throw new Error("unexpected fixture output");
}

process.stdout.write(
  JSON.stringify({ state: "BROWSER_RUNTIME_OK", ...output.diagnostics }) + "\n",
);
