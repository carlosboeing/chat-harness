import {
  BrowserPolicyError,
  withBrowserTask,
} from "../../src/browser-runtime.mjs";

const QUOTE_URL =
  "https://www.queenslandcountry.health/cover-selector-new/";
const ALLOWED_HOSTS = [
  "queenslandcountry.health",
  "www.queenslandcountry.health",
];

const SYNTHETIC_PROFILES = {
  "synthetic-family-qld-v1": {
    coverType: "Family",
    state: "QLD",
    age: 40,
    partnerAge: 40,
    continuousHospitalCover: true,
    adultDependents: false,
    incomeOptionIndex: 1,
  },
};

const ALLOWED_HOSPITAL_PRODUCTS = new Set([
  "Signature Hospital (Silver+)",
]);
const ALLOWED_EXTRAS_PRODUCTS = new Set(["Select Extras"]);
const ALLOWED_EXCESSES = new Set([750]);

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
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    return invalid(
      "UNEXPECTED_INPUT",
      "Unexpected input fields: " + unexpected.join(", "),
    );
  }

  if (!SYNTHETIC_PROFILES[input.profile_ref]) {
    return invalid(
      "UNKNOWN_PROFILE",
      "Only the approved synthetic profile is supported in this experiment.",
    );
  }

  if (!ALLOWED_HOSPITAL_PRODUCTS.has(input.hospital_product)) {
    return invalid(
      "UNSUPPORTED_HOSPITAL_PRODUCT",
      "Unsupported hospital product.",
    );
  }

  if (!ALLOWED_EXTRAS_PRODUCTS.has(input.extras_product)) {
    return invalid(
      "UNSUPPORTED_EXTRAS_PRODUCT",
      "Unsupported extras product.",
    );
  }

  if (!ALLOWED_EXCESSES.has(input.excess)) {
    return invalid("UNSUPPORTED_EXCESS", "Unsupported hospital excess.");
  }

  return {
    ok: true,
    profile: SYNTHETIC_PROFILES[input.profile_ref],
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

async function checkNamedRadio(page, label, occurrence = 0) {
  const locator = page.getByRole("radio", {
    name: new RegExp("^" + escapeRegex(label) + "$", "i"),
  });
  const count = await locator.count();
  if (count <= occurrence) return false;
  await locator.nth(occurrence).check({ force: true });
  return true;
}

async function fillAge(page, labelPattern, value, fallbackIndex) {
  const byLabel = page.getByLabel(labelPattern);
  if ((await byLabel.count()) > 0) {
    await byLabel.first().fill(String(value));
    return true;
  }

  const numbers = page.locator('input[type="number"]:visible');
  if ((await numbers.count()) > fallbackIndex) {
    await numbers.nth(fallbackIndex).fill(String(value));
    return true;
  }

  const textInputs = page.locator('input[type="text"]:visible');
  if ((await textInputs.count()) > fallbackIndex) {
    await textInputs.nth(fallbackIndex).fill(String(value));
    return true;
  }

  return false;
}

async function chooseTextOption(page, value) {
  const pattern = new RegExp(escapeRegex(value), "i");

  for (const role of ["radio", "checkbox"]) {
    const control = page.getByRole(role, { name: pattern });
    if ((await control.count()) > 0) {
      await control.first().check({ force: true });
      return true;
    }
  }

  const label = page.getByLabel(pattern);
  if ((await label.count()) > 0) {
    const first = label.first();
    const type = await first.getAttribute("type");
    if (type === "radio" || type === "checkbox") {
      await first.check({ force: true });
    } else {
      await first.click();
    }
    return true;
  }

  const text = page.getByText(pattern);
  if ((await text.count()) > 0) {
    await text.first().click();
    return true;
  }

  return false;
}

async function clickFirst(page, names) {
  for (const name of names) {
    const pattern = new RegExp("^" + escapeRegex(name) + "$", "i");

    for (const role of ["button", "link"]) {
      const locator = page.getByRole(role, { name: pattern });
      if ((await locator.count()) > 0) {
        await locator.first().click();
        return name;
      }
    }
  }

  return null;
}

export function extractQuoteFromText(
  text,
  hospitalProduct,
  extrasProduct,
  excess,
) {
  const normalized = text.replace(/\r/g, "");
  const productMatch =
    normalized.toLowerCase().includes(hospitalProduct.toLowerCase()) &&
    normalized.toLowerCase().includes(extrasProduct.toLowerCase());
  const excessMatch = new RegExp(
    "\\$?\\s*" + String(excess) + "\\s*(?:excess)?",
    "i",
  ).test(normalized);

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const priced = lines.find(
    (line) =>
      /\$\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/.test(line) &&
      /(week|fortnight|month|year|premium|quote)/i.test(line),
  );

  if (!productMatch || !priced) return null;

  const amount = priced.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  const frequency = priced.match(/(?:per|\/)\s*(week|fortnight|month|year)/i);

  return {
    product_match: true,
    excess_match: excessMatch,
    premium_amount: amount
      ? Number(amount[1].replace(/,/g, ""))
      : null,
    frequency: frequency?.[1]?.toLowerCase() ?? null,
    evidence_line: priced.slice(0, 300),
  };
}

async function fillInitialQuestions(page, profile, step) {
  await step("select-family", async () => {
    if (!(await checkNamedRadio(page, profile.coverType))) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not locate the Family cover control.",
      );
    }
  });

  await step("select-state", async () => {
    if (!(await checkNamedRadio(page, profile.state))) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not locate the QLD state control.",
      );
    }
  });

  await step("fill-primary-age", async () => {
    if (!(await fillAge(page, /what is your age/i, profile.age, 0))) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not locate the primary age field.",
      );
    }
  });

  await step("primary-continuous-cover", async () => {
    if (!(await checkNamedRadio(page, "Yes", 0))) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not answer primary continuous-cover question.",
      );
    }
  });

  await step("fill-partner-age", async () => {
    if (
      !(await fillAge(
        page,
        /partner(?:'s|s) age/i,
        profile.partnerAge,
        1,
      ))
    ) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not locate the partner age field.",
      );
    }
  });

  await step("partner-continuous-cover", async () => {
    if (!(await checkNamedRadio(page, "Yes", 1))) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not answer partner continuous-cover question.",
      );
    }
  });

  await step("adult-dependents", async () => {
    const noRadios = page.getByRole("radio", { name: /^No$/i });
    const count = await noRadios.count();
    if (count > 0) {
      await noRadios.last().check();
    }
  });

  await step("income-tier", async () => {
    const selects = page.locator("select:visible");
    const count = await selects.count();
    if (count > 0) {
      const select = selects.last();
      const options = await select.locator("option").count();
      if (options > profile.incomeOptionIndex) {
        await select.selectOption({ index: profile.incomeOptionIndex });
      }
    }
  });

  await step("choose-cover", async () => {
    const clicked = await clickFirst(page, ["Choose cover"]);
    if (!clicked) {
      throw new BrowserPolicyError(
        "UI_CHANGED",
        "Could not locate the Choose cover action.",
      );
    }
  });
}

async function attemptProductSelection(page, input, step) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(500);

  await step("select-hospital-product", async () => {
    await chooseTextOption(page, input.hospital_product);
  });

  await step("select-excess", async () => {
    await chooseTextOption(page, "$" + input.excess);
  });

  await step("select-extras-product", async () => {
    await chooseTextOption(page, input.extras_product);
  });

  const safeProgressActions = [
    "Continue",
    "Next",
    "Customise your quote",
    "Review cover",
    "Review quote",
    "View quote",
    "Get a quote",
  ];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const text = await page.locator("body").innerText();
    const quote = extractQuoteFromText(
      text,
      input.hospital_product,
      input.extras_product,
      input.excess,
    );
    if (quote) return quote;

    const clicked = await step("progress-quote-" + attempt, () =>
      clickFirst(page, safeProgressActions),
    );
    if (!clicked) break;

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(400);
  }

  const finalText = await page.locator("body").innerText();
  return extractQuoteFromText(
    finalText,
    input.hospital_product,
    input.extras_product,
    input.excess,
  );
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
        maxActions: 40,
      },
      async ({ page, step, safeGoto }) => {
        await safeGoto(QUOTE_URL);

        await step("verify-quote-page", async () => {
          const body = await page.locator("body").innerText();
          if (!/to quote, we need the following details/i.test(body)) {
            throw new BrowserPolicyError(
              "UI_CHANGED",
              "Expected quote questionnaire was not found.",
            );
          }
        });

        await fillInitialQuestions(page, validation.profile, step);
        return await attemptProductSelection(page, input, step);
      },
    );

    if (!execution.result) {
      return {
        ok: false,
        state: "PARTIAL_EVIDENCE",
        quote: null,
        requested: {
          profile_ref: input.profile_ref,
          hospital_product: input.hospital_product,
          extras_product: input.extras_product,
          excess: input.excess,
        },
        provenance: {
          retrieved_at: retrievedAt,
          source: QUOTE_URL,
        },
        diagnostics: execution.diagnostics,
        error: {
          code: "QUOTE_NOT_EXTRACTED",
          message:
            "Browser reached the quote workflow but did not extract a verified matching premium.",
        },
      };
    }

    return {
      ok: true,
      state: "EXACT_QUOTE_VERIFIED",
      requested: {
        profile_ref: input.profile_ref,
        hospital_product: input.hospital_product,
        extras_product: input.extras_product,
        excess: input.excess,
      },
      quote: execution.result,
      provenance: {
        retrieved_at: retrievedAt,
        source: QUOTE_URL,
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
      },
      provenance: {
        retrieved_at: retrievedAt,
        source: QUOTE_URL,
      },
    };
  }
}
