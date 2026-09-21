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

  await page.locator("#CoverType_family").check({ force: true });
  await page.locator("#state_QLD").check({ force: true });
  await page.locator("#Member_Age").fill("40");
  await page.locator("#Member_ContinuousCover_Yes").check({ force: true });
  await page.locator("#Partner_Age").fill("40");
  await page.locator("#Partner_ContinuousCover_Yes").check({ force: true });
  await page.locator("#Dependants_YoungAdult_No").check({ force: true });
  await page.locator("#AssessableIncome_Couple").selectOption("0");

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.getByRole("button", { name: /^Choose cover$/i }).click(),
  ]);
  await page.waitForTimeout(700);

  const controls = await page.locator("input, select, button, a").evaluateAll((els) =>
    els
      .map((el) => {
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
          text:
            el.tagName === "BUTTON" || el.tagName === "A"
              ? el.innerText.trim()
              : null,
          href: el.tagName === "A" ? el.getAttribute("href") : null,
          options:
            el.tagName === "SELECT"
              ? [...el.options].map((o) => ({ value: o.value, text: o.text.trim() }))
              : null,
        };
      })
      .filter((x) =>
        x.id ||
        x.name ||
        /continue|next|quote|signature|select extras|750/i.test(x.text || x.label || "")
      ),
  );

  const body = (await page.locator("body").innerText())
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 14000);

  process.stdout.write(
    JSON.stringify({ url: page.url(), controls, body }, null, 2) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
