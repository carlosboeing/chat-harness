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
  await page.locator("#Member_Age").blur();
  await page.waitForTimeout(150);
  await page.locator("#Member_ContinuousCover_Yes").check({ force: true });
  await page.locator("#Partner_Age").fill("40");
  await page.locator("#Partner_Age").blur();
  await page.waitForTimeout(150);
  await page.locator("#Partner_ContinuousCover_Yes").check({ force: true });
  await page.locator("#Dependants_YoungAdult_No").check({ force: true });
  await page.locator("#AssessableIncome_Couple").selectOption("0");
  await page.locator('button[type="submit"]').filter({ hasText: /Choose cover/i }).click({ force: true });

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("#SG750").check({ force: true });
  await page.locator("#choose_61951").check({ force: true });
  await page.locator('button[type="submit"]').filter({ hasText: /Choose extras/i }).click({ force: true });

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("#choose_2457").check({ force: true });
  await page.locator('button[type="submit"]').filter({ hasText: /Review cover/i }).click({ force: true });

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(800);

  const controls = await page
    .locator("input, select, button, a")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type"),
          id: el.id || null,
          name: el.getAttribute("name"),
          value: el.getAttribute("value"),
          text:
            el.tagName === "BUTTON" || el.tagName === "A"
              ? el.innerText.trim()
              : null,
          href: el.tagName === "A" ? el.getAttribute("href") : null,
          parent_text:
            el.parentElement?.innerText?.replace(/\s+/g, " ").trim().slice(0, 700) ?? null,
        }))
        .filter((x) =>
          x.id ||
          x.name ||
          /quote|join|continue|premium|weekly|monthly|signature|select extras|review/i.test(
            [x.text, x.parent_text].filter(Boolean).join(" "),
          )
        ),
    );

  const body = (await page.locator("body").innerText())
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 30000);

  process.stdout.write(
    JSON.stringify({ url: page.url(), title: await page.title(), controls, body }, null, 2) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
