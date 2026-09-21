import {
  BrowserPolicyError,
  withBrowserTask,
} from "../../src/browser-runtime.mjs";

const QUOTE_URL =
  "https://www.queenslandcountry.health/cover-selector-new/";
const REVIEW_PATH =
  "/cover-selector-new/cover-selector---review/";
const ALLOWED_HOSTS = [
  "queenslandcountry.health",
  "www.queenslandcountry.health",
];

const SYNTHETIC_PROFILES = {
  "synthetic-family-qld-v1": {
    coverType: "Family",
    state: "QLD",
    memberAge: 40,
    partnerAge: 40,
    memberContinuousCover: true,
    partnerContinuousCover: true,
    adultDependents: false,
    incomeTier: "0",
  },
};

const SUPPORTED_REQUEST = {
  hospitalProduct: "Signature Hospital (Silver+)",
  extrasProduct: "Select Extras",
  excess: 750,
  paymentFrequency: "monthly",
};

function invalid(code, message) {
  return {
    ok: false,
    state: "INVALID_INPUT",
    error: { code, message },
  };
}

export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalid("INVALID_INPUT", "Input must be an object.");
  }

  const allowed = new Set([
    "profile_ref",
    "hospital_product",
    "extras_product",
    "excess",
    "payment_frequency",
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    return invalid(
      "UNEXPECTED_INPUT",
      "Unexpected input fields: " + unexpected.join(", "),
    );
  }

  const profile = SYNTHETIC_PROFILES[input.profile_ref];
  if (!profile) {
    return invalid(
      "UNKNOWN_PROFILE",
      "Only the approved synthetic profile is supported in this experiment.",
    );
  }

  if (input.hospital_product !== SUPPORTED_REQUEST.hospitalProduct) {
    return invalid(
      "UNSUPPORTED_HOSPITAL_PRODUCT",
      "Unsupported hospital product.",
    );
  }

  if (input.extras_product !== SUPPORTED_REQUEST.extrasProduct) {
    return invalid(
      "UNSUPPORTED_EXTRAS_PRODUCT",
      "Unsupported extras product.",
    );
  }

  if (input.excess !== SUPPORTED_REQUEST.excess) {
    return invalid("UNSUPPORTED_EXCESS", "Unsupported hospital excess.");
  }

  if (input.payment_frequency !== SUPPORTED_REQUEST.paymentFrequency) {
    return invalid(
      "UNSUPPORTED_PAYMENT_FREQUENCY",
      "Only monthly payment frequency is supported in this experiment.",
    );
  }

  return { ok: true, profile };
}

function numberFromMatch(match) {
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function parseReviewEvidence({
  bodyText,
  summaryText,
  selectedFrequency,
  selectedExcess,
  combinedProductId,
}) {
  if (typeof bodyText !== "string" || typeof summaryText !== "string") {
    return null;
  }

  const normalizedBody = bodyText.replace(/\r/g, "");
  const normalizedSummary = summaryText.replace(/\s+/g, " ").trim();

  const hospitalMatch = normalizedBody.match(
    /Signature Hospital \(Silver\+\)\s*\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const extrasMatch = normalizedBody.match(
    /Select Extras\s*\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const totalMatch = normalizedSummary.match(
    /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+Monthly\s+with\s+\$750\s+hospital excess/i,
  );
  const rebateMatch = normalizedBody.match(
    /Government Rebate of\s*([0-9]+(?:\.[0-9]+)?)%/i,
  );
  const ageDiscountMatch = normalizedBody.match(
    /Age based discount of\s*([0-9]+(?:\.[0-9]+)?)%/i,
  );
  const lhcMatch = normalizedBody.match(
    /Lifetime Health Cover loading of\s*([0-9]+(?:\.[0-9]+)?)%/i,
  );

  if (
    !hospitalMatch ||
    !extrasMatch ||
    !totalMatch ||
    selectedFrequency !== "monthly" ||
    selectedExcess !== true
  ) {
    return null;
  }

  const hospitalAmount = numberFromMatch(hospitalMatch);
  const extrasAmount = numberFromMatch(extrasMatch);
  const premiumAmount = numberFromMatch(totalMatch);

  if (
    hospitalAmount === null ||
    extrasAmount === null ||
    premiumAmount === null ||
    Math.abs(hospitalAmount + extrasAmount - premiumAmount) > 0.02
  ) {
    return null;
  }

  return {
    product_match: true,
    excess_match: true,
    payment_frequency_match: true,
    combined_product_id:
      typeof combinedProductId === "string" && combinedProductId
        ? combinedProductId
        : null,
    premium_amount: premiumAmount,
    frequency: "monthly",
    hospital_component: hospitalAmount,
    extras_component: extrasAmount,
    government_rebate_percent: numberFromMatch(rebateMatch),
    age_based_discount_percent: numberFromMatch(ageDiscountMatch),
    lifetime_health_cover_loading_percent: numberFromMatch(lhcMatch),
    evidence_summary: normalizedSummary.slice(0, 300),
  };
}

async function fillInitialQuestionnaire(page, profile, step) {
  await step("select-family", () =>
    page.locator("#CoverType_family").check({ force: true }),
  );
  await step("select-state", () =>
    page.locator("#state_QLD").check({ force: true }),
  );

  await step("fill-member-age", async () => {
    const age = page.locator("#Member_Age");
    await age.fill(String(profile.memberAge));
    await age.blur();
    await page.waitForTimeout(150);
  });
  await step("member-continuous-cover", () =>
    page.locator("#Member_ContinuousCover_Yes").check({ force: true }),
  );

  await step("fill-partner-age", async () => {
    const age = page.locator("#Partner_Age");
    await age.fill(String(profile.partnerAge));
    await age.blur();
    await page.waitForTimeout(150);
  });
  await step("partner-continuous-cover", () =>
    page.locator("#Partner_ContinuousCover_Yes").check({ force: true }),
  );

  await step("adult-dependents", () =>
    page.locator("#Dependants_YoungAdult_No").check({ force: true }),
  );
  await step("income-tier", () =>
    page.locator("#AssessableIncome_Couple").selectOption(profile.incomeTier),
  );

  await step("submit-questionnaire", async () => {
    const submit = page
      .locator('button[type="submit"]')
      .filter({ hasText: /Choose cover/i });

    if ((await submit.count()) !== 1) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected one Choose cover action.",
      );
    }

    await submit.click({ force: true });
  });
}

async function chooseHospital(page, step) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(300);

  await step("verify-hospital-page", async () => {
    if (!page.url().includes("/cover-selector-new/choose-cover/")) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected hospital-selection page was not reached.",
      );
    }
  });

  await step("select-signature-excess", () =>
    page.locator("#SG750").check({ force: true }),
  );
  await step("select-signature-hospital", () =>
    page.locator("#choose_61951").check({ force: true }),
  );

  await step("submit-hospital", async () => {
    const submit = page
      .locator('button[type="submit"]')
      .filter({ hasText: /Choose extras/i });

    if ((await submit.count()) !== 1) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected one Choose extras action.",
      );
    }

    await submit.click({ force: true });
  });
}

async function chooseExtras(page, step) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(300);

  await step("verify-extras-page", async () => {
    if (!page.url().includes("/cover-selector-new/choose-extras/")) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected extras-selection page was not reached.",
      );
    }
  });

  await step("select-extras", () =>
    page.locator("#choose_2457").check({ force: true }),
  );

  await step("submit-extras", async () => {
    const submit = page
      .locator('button[type="submit"]')
      .filter({ hasText: /Review cover/i });

    if ((await submit.count()) !== 1) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected one Review cover action.",
      );
    }

    await submit.click({ force: true });
  });
}

async function extractReview(page, step) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(300);

  await step("verify-review-page", async () => {
    const url = new URL(page.url());
    if (url.pathname !== REVIEW_PATH) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected quote review page was not reached.",
      );
    }
  });

  await step("set-monthly-frequency", async () => {
    const frequency = page.locator("select#frequency");
    if ((await frequency.count()) !== 1) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected payment-frequency selector was not found.",
      );
    }
    await frequency.selectOption("monthly");
    await page.waitForTimeout(500);
  });

  return await step("extract-verified-quote", async () => {
    const bodyText = await page.locator("body").innerText();
    const summaryButton = page
      .getByRole("button", { name: /Toggle product details/i })
      .first();

    if ((await summaryButton.count()) !== 1) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Expected quote summary was not found.",
      );
    }

    const summaryText = await summaryButton.evaluate(
      (el) => el.parentElement?.innerText ?? "",
    );
    const selectedFrequency = await page.locator("select#frequency").inputValue();
    const selectedExcess = await page.locator("#SG750").isChecked();
    const combinedProductId =
      (await page.locator("#pid").count()) === 1
        ? await page.locator("#pid").inputValue()
        : null;

    const quote = parseReviewEvidence({
      bodyText,
      summaryText,
      selectedFrequency,
      selectedExcess,
      combinedProductId,
    });

    if (!quote) {
      throw new BrowserPolicyError(
        "PARTIAL_EVIDENCE",
        "Review page did not contain internally consistent exact quote evidence.",
      );
    }

    return quote;
  });
}

function mapBrowserFailure(error) {
  if (error instanceof BrowserPolicyError) {
    if (error.code === "ABORTED") {
      return {
        ok: false,
        state: "TIMEOUT",
        error: { code: "TIMEOUT", message: "Browser execution timed out." },
      };
    }

    if (error.code === "PARTIAL_EVIDENCE") {
      return {
        ok: false,
        state: "PARTIAL_EVIDENCE",
        error: { code: error.code, message: error.message },
      };
    }

    return {
      ok: false,
      state: error.code === "UI_CHANGED" ? "UI_CHANGED" : "BROWSER_BLOCKED",
      error: { code: error.code, message: error.message },
    };
  }

  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Browser failed.";

  if (/captcha|challenge|access denied|bot/i.test(message)) {
    return {
      ok: false,
      state: "BOT_BLOCKED",
      error: { code: "BOT_BLOCKED", message },
    };
  }

  return {
    ok: false,
    state: "QUOTE_UNAVAILABLE",
    error: { code: "QUOTE_UNAVAILABLE", message },
  };
}

export async function run(input, context = {}) {
  const validation = validateInput(input);
  if (!validation.ok) return validation;

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
        await safeGoto(QUOTE_URL);

        await step("verify-questionnaire", async () => {
          const body = await page.locator("body").innerText();
          if (!/to quote, we need the following details/i.test(body)) {
            throw new BrowserPolicyError(
              "UI_CHANGED",
              "Expected quote questionnaire was not found.",
            );
          }
        });

        await fillInitialQuestionnaire(page, validation.profile, step);
        await chooseHospital(page, step);
        await chooseExtras(page, step);
        return await extractReview(page, step);
      },
    );

    return {
      ok: true,
      state: "EXACT_QUOTE_VERIFIED",
      requested: {
        profile_ref: input.profile_ref,
        hospital_product: input.hospital_product,
        extras_product: input.extras_product,
        excess: input.excess,
        payment_frequency: input.payment_frequency,
      },
      quote: execution.result,
      provenance: {
        retrieved_at: retrievedAt,
        source: QUOTE_URL,
        final_path: REVIEW_PATH,
      },
      diagnostics: execution.diagnostics,
    };
  } catch (error) {
    return {
      ...mapBrowserFailure(error),
      requested: {
        profile_ref: input.profile_ref,
        hospital_product: input.hospital_product,
        extras_product: input.extras_product,
        excess: input.excess,
        payment_frequency: input.payment_frequency,
      },
      provenance: {
        retrieved_at: retrievedAt,
        source: QUOTE_URL,
      },
    };
  }
}
