import {
  BrowserPolicyError,
  withBrowserTask,
} from "../../src/browser-runtime.mjs";

const START_URL = "https://www.queenslandcountry.health/cover-selector-new/";
const ALLOWED_HOSTS = [
  "www.queenslandcountry.health",
  "queenslandcountry.health",
];

const SUPPORTED_HOSPITAL_PRODUCTS = new Map([
  ["Signature Hospital (Silver+)", "Choose Signature Hospital"],
]);
const SUPPORTED_EXTRAS_PRODUCTS = new Map([
  ["Select Extras", "Add Select Extras"],
]);

const SYNTHETIC_PROFILE = Object.freeze({
  profile_ref: "synthetic-family-qld-v1",
  cover_type: "Family",
  state: "QLD",
  primary_age: "45",
  partner_age: "42",
});

function failure(state, error, extra = {}) {
  return {
    ok: false,
    state,
    error:
      typeof error === "string"
        ? { code: state, message: error }
        : error ?? null,
    ...extra,
  };
}

function assertInput(input) {
  const allowed = new Set([
    "profile_ref",
    "hospital_product",
    "extras_product",
    "excess",
    "payment_frequency",
  ]);
  const unexpected = Object.keys(input ?? {}).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error("Unexpected input fields: " + unexpected.join(", "));
  }

  if (input?.profile_ref !== SYNTHETIC_PROFILE.profile_ref) {
    throw new Error("Only the synthetic profile is allowed in this experiment.");
  }
  if (!SUPPORTED_HOSPITAL_PRODUCTS.has(input?.hospital_product)) {
    throw new Error("Unsupported hospital product for this experiment.");
  }
  if (!SUPPORTED_EXTRAS_PRODUCTS.has(input?.extras_product)) {
    throw new Error("Unsupported extras product for this experiment.");
  }
  if (input?.excess !== 750) {
    throw new Error("Only the $750 excess is allowed in this experiment.");
  }
  if (input?.payment_frequency !== "weekly") {
    throw new Error("Only weekly payment frequency is allowed in this experiment.");
  }
}

async function setRadioById(page, id) {
  const locator = page.locator("#" + id);
  await locator.waitFor({ state: "attached" });
  await locator.evaluate((element) => {
    element.checked = true;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function fillField(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    await locator.waitFor({ state: "attached" });
    await locator.fill(value);
    return;
  }
  throw new BrowserPolicyError(
    "UI_CHANGED",
    "Expected quote field was not found: " + selectors.join(", "),
  );
}

async function selectFirstMeaningfulIncomeOption(page) {
  const select = page.locator("#AssessableIncome_Couple").first();
  if ((await select.count()) === 0) {
    throw new BrowserPolicyError("UI_CHANGED", "Income selector was not found.");
  }

  const options = await select.locator("option").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      value: node.value,
      text: node.textContent?.trim() ?? "",
      disabled: node.disabled,
    })),
  );
  const option = options.find(
    (x) => x.index > 0 && !x.disabled && x.value !== "" && !/select/i.test(x.text),
  );

  if (!option) {
    throw new BrowserPolicyError(
      "UI_CHANGED",
      "Income selector had no usable option.",
    );
  }

  await select.selectOption({ index: option.index });
  return option.text;
}

async function clickVisibleText(page, text) {
  const matches = page.getByText(text, { exact: true });
  const count = await matches.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = matches.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      return;
    }
  }

  throw new BrowserPolicyError(
    "UI_CHANGED",
    "Visible control not found for text: " + text,
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

export function extractEvidence(bodyText, hospitalProduct, extrasProduct) {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const hospitalIndex = lower.indexOf(hospitalProduct.toLowerCase());
  const extrasIndex = lower.indexOf(extrasProduct.toLowerCase());

  const start =
    hospitalIndex >= 0 && extrasIndex >= 0
      ? Math.max(0, Math.min(hospitalIndex, extrasIndex) - 250)
      : Math.max(0, hospitalIndex >= 0 ? hospitalIndex - 250 : extrasIndex - 250);
  const snippet =
    hospitalIndex >= 0 || extrasIndex >= 0
      ? normalized.slice(start, start + 2_500)
      : normalized.slice(0, 2_500);

  const prices = [...snippet.matchAll(/\$\s?\d+(?:\.\d{2})?/g)].map(
    (match) => match[0],
  );

  const summaryPattern = new RegExp(
    escapeRegex(hospitalProduct) +
      "\\s*\\$\\s*(\\d+(?:\\.\\d{2})?)\\s*" +
      escapeRegex(extrasProduct) +
      "\\s*\\$\\s*(\\d+(?:\\.\\d{2})?)\\s*" +
      "(\\d+(?:\\.\\d{2})?)\\s*Payment frequency",
    "i",
  );
  const summaryMatch = normalized.match(summaryPattern);

  const quoteSummary = summaryMatch
    ? {
        hospital_price: Number(summaryMatch[1]),
        extras_price: Number(summaryMatch[2]),
        combined_price: Number(summaryMatch[3]),
      }
    : null;

  const internallyConsistent =
    quoteSummary !== null &&
    Math.abs(
      quoteSummary.hospital_price +
        quoteSummary.extras_price -
        quoteSummary.combined_price,
    ) <= 0.02;

  return {
    hospital_product_found: hospitalIndex >= 0,
    extras_product_found: extrasIndex >= 0,
    prices: [...new Set(prices)].slice(0, 10),
    quote_summary: internallyConsistent ? quoteSummary : null,
    rebate_percent:
      Number(
        normalized.match(/Government Rebate of\s+(\d+(?:\.\d+)?)%/i)?.[1],
      ) || null,
    age_based_discount_percent:
      Number(
        normalized.match(/Age based discount of\s+(\d+(?:\.\d+)?)%/i)?.[1],
      ) || 0,
    lhc_loading_percent:
      Number(
        normalized.match(
          /Lifetime Health Cover loading of\s+(\d+(?:\.\d+)?)%/i,
        )?.[1],
      ) || 0,
    evidence_snippet: snippet.slice(0, 2_500),
  };
}

function mapBrowserError(error) {
  if (error instanceof BrowserPolicyError) {
    if (error.code === "ABORTED") {
      return failure("TIMEOUT", {
        code: "TIMEOUT",
        message: "Browser execution exceeded its configured time budget.",
      });
    }

    const state =
      error.code === "UI_CHANGED" ? "UI_CHANGED" : "BROWSER_POLICY_BLOCKED";
    return failure(state, {
      code: error.code,
      message: error.message.slice(0, 1000),
    });
  }

  const message =
    error instanceof Error ? error.message.slice(0, 1000) : "Browser failed.";

  if (/captcha|challenge|access denied|bot/i.test(message)) {
    return failure("BOT_BLOCKED", {
      code: "BOT_BLOCKED",
      message,
    });
  }

  return failure("INTERACTION_FAILED", {
    code: "INTERACTION_FAILED",
    message,
  });
}

export async function run(input, context = {}) {
  try {
    assertInput(input);
  } catch (error) {
    return failure("INVALID_INPUT", {
      code: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "Invalid input.",
    });
  }

  const retrievedAt = new Date().toISOString();

  try {
    const execution = await withBrowserTask(
      {
        signal: context.signal,
        allowedHosts: ALLOWED_HOSTS,
        locale: "en-AU",
        timezoneId: "Australia/Brisbane",
        maxActions: 30,
      },
      async ({ page, step, safeGoto }) => {
        await safeGoto(START_URL);

        await step("select-cover-type", () =>
          page.locator("#CoverType_family").check({ force: true }),
        );
        await step("select-state", () =>
          page.locator("#state_QLD").check({ force: true }),
        );
        await step("fill-primary-age", () =>
          fillField(
            page,
            ["#Member_Age", 'input[name="Member_Age"]'],
            SYNTHETIC_PROFILE.primary_age,
          ),
        );
        await step("primary-continuous-cover", () =>
          setRadioById(page, "Member_ContinuousCover_Yes"),
        );
        await step("fill-partner-age", () =>
          fillField(
            page,
            [
              "#Partner_Age",
              'input[name="Partner_Age"]',
              'input[name*="Partner"][type="number"]',
            ],
            SYNTHETIC_PROFILE.partner_age,
          ),
        );
        await step("partner-continuous-cover", () =>
          setRadioById(page, "Partner_ContinuousCover_Yes"),
        );
        await step("no-young-adult-dependants", () =>
          setRadioById(page, "Dependants_YoungAdult_No"),
        );

        const selectedIncomeOption = await step("select-income", () =>
          selectFirstMeaningfulIncomeOption(page),
        );

        await step("choose-cover", async () => {
          const button = page.getByRole("button", { name: /choose cover/i });
          if ((await button.count()) === 0) {
            throw new BrowserPolicyError(
              "UI_CHANGED",
              "Choose cover action was not found.",
            );
          }
          await button.first().click();
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(700);
        });

        await step("select-excess", () => setRadioById(page, "SG750"));

        await step("select-weekly-frequency", async () => {
          const signatureCard = page
            .locator("#SG750")
            .locator("xpath=ancestor::*[.//select[@name='PaymentFrequency']][1]");
          const frequency = signatureCard
            .locator('select[name="PaymentFrequency"]')
            .first();

          if ((await frequency.count()) === 0) {
            throw new BrowserPolicyError(
              "UI_CHANGED",
              "Signature Hospital payment-frequency selector was not found.",
            );
          }
          await frequency.selectOption({ label: "Weekly" });
        });

        await step("select-hospital-product", () =>
          clickVisibleText(
            page,
            SUPPORTED_HOSPITAL_PRODUCTS.get(input.hospital_product),
          ),
        );
        await page.waitForTimeout(600);

        await step("select-extras-product", async () => {
          let body = await page.locator("body").innerText();
          if (!body.includes(input.extras_product)) {
            const chooseExtras = page.getByText("Choose extras", { exact: true });
            for (let i = 0; i < (await chooseExtras.count()); i += 1) {
              if (await chooseExtras.nth(i).isVisible().catch(() => false)) {
                await chooseExtras.nth(i).click();
                await page.waitForTimeout(600);
                break;
              }
            }
          }

          body = await page.locator("body").innerText();
          if (!body.includes(input.extras_product)) {
            throw new BrowserPolicyError(
              "UI_CHANGED",
              "Expected extras product was not shown.",
            );
          }

          await clickVisibleText(
            page,
            SUPPORTED_EXTRAS_PRODUCTS.get(input.extras_product),
          );
          await page.waitForTimeout(600);
        });

        await step("review-cover", async () => {
          await clickVisibleText(page, "Review cover");
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(800);
        });

        const bodyText = await step("extract-review", () =>
          page.locator("body").innerText(),
        );
        const evidence = extractEvidence(
          bodyText,
          input.hospital_product,
          input.extras_product,
        );

        const reviewReached =
          /review/i.test(new URL(page.url()).pathname) ||
          /Cover Selector\s*-\s*Review/i.test(bodyText) ||
          /Step 4\s+current/i.test(bodyText);

        const exact =
          reviewReached &&
          evidence.hospital_product_found &&
          evidence.extras_product_found &&
          evidence.quote_summary !== null;

        if (!exact) {
          throw new BrowserPolicyError(
            "UI_CHANGED",
            "Review page did not contain internally consistent exact quote evidence.",
          );
        }

        return {
          profile: {
            profile_ref: SYNTHETIC_PROFILE.profile_ref,
            synthetic: true,
            selected_income_option: selectedIncomeOption,
          },
          target: {
            hospital_product: input.hospital_product,
            extras_product: input.extras_product,
            excess: input.excess,
            payment_frequency: input.payment_frequency,
          },
          evidence: {
            ...evidence,
            review_reached: true,
          },
          quote: {
            premium: evidence.quote_summary.combined_price,
            hospital_component: evidence.quote_summary.hospital_price,
            extras_component: evidence.quote_summary.extras_price,
            payment_frequency: "Weekly",
            excess: "$750 excess",
            rebate_percent: evidence.rebate_percent,
            age_based_discount_percent: evidence.age_based_discount_percent,
            lhc_loading_percent: evidence.lhc_loading_percent,
          },
        };
      },
    );

    return {
      ok: true,
      state: "EXACT_QUOTE_VERIFIED",
      ...execution.result,
      provenance: {
        retrieved_at: retrievedAt,
        start_url: START_URL,
        final_url: execution.diagnostics.final_url,
        execution: "playwright",
      },
      diagnostics: execution.diagnostics,
    };
  } catch (error) {
    const mapped = mapBrowserError(error);
    return {
      ...mapped,
      provenance: {
        retrieved_at: retrievedAt,
        start_url: START_URL,
        execution: "playwright",
      },
      diagnostics: error?.browserDiagnostics ?? null,
    };
  }
}
