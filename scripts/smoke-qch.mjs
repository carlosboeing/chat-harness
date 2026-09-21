import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "en-AU",
  timezoneId: "Australia/Brisbane",
  serviceWorkers: "block",
});

try {
  const page = await context.newPage();
  await page.goto(
    "https://www.queenslandcountry.health/cover-selector-new/",
    { waitUntil: "domcontentloaded" },
  );

  const controls = await page.locator("input, select, button").evaluateAll((els) =>
    els.map((el) => {
      const id = el.id || null;
      const label = id
        ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.innerText?.trim() ?? null
        : null;

      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        id,
        name: el.getAttribute("name"),
        value: el.getAttribute("value"),
        label,
        placeholder: el.getAttribute("placeholder"),
        text: el.tagName === "BUTTON" ? el.innerText.trim() : null,
        options:
          el.tagName === "SELECT"
            ? [...el.options].map((o) => ({ value: o.value, text: o.text.trim() }))
            : null,
      };
    }),
  );

  process.stdout.write(JSON.stringify(controls, null, 2) + "\n");
} finally {
  await context.close();
  await browser.close();
}
