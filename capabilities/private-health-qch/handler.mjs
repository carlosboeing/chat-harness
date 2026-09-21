const START_URL = "https://www.queenslandcountry.health/cover-selector-new/";
const ALLOWED_TOP_LEVEL_HOSTS = new Set([
  "www.queenslandcountry.health",
  "queenslandcountry.health",
]);
const SYNTHETIC_PROFILE = Object.freeze({
  profile_ref: "synthetic-family-qld-v1",
  cover_type: "Family",
  state: "QLD",
  primary_age: "45",
  partner_age: "42",
  primary_continuous_cover: "Yes",
  partner_continuous_cover: "Yes",
  adult_dependants_21_to_31: "No",
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
  const allowed = new Set(["profile_ref", "hospital_product", "extras_product"]);
  const unexpected = Object.keys(input ?? {}).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error("Unexpected input fields: " + unexpected.join(", "));
  }

  if (input?.profile_ref !== SYNTHETIC_PROFILE.profile_ref) {
    throw new Error("Only the synthetic profile is allowed in this experiment.");
  }

  for (const key of ["hospital_product", "extras_product"]) {
    if (
      typeof input?.[key] !== "string" ||
      input[key].trim().length === 0 ||
      input[key].length > 120
    ) {
      throw new Error(key + " must be a non-empty string up to 120 characters.");
    }
  }
}

function isAllowedTopLevelUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && ALLOWED_TOP_LEVEL_HOSTS.has(url.hostname);
}

async function collectVisibleControls(page) {
  return page.locator("input:visible, select:visible, button:visible").evaluateAll(
    (nodes) =>
      nodes.slice(0, 50).map((node) => ({
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute("type"),
        name: node.getAttribute("name"),
        id: node.id || null,
        aria_label: node.getAttribute("aria-label"),
        labels: node.labels ? Array.from(node.labels).map((x) => x.innerText.trim()) : [],
        text: node.tagName === "BUTTON" ? node.innerText.trim().slice(0, 120) : null,
      })),
  );
}

async function checkByLabel(page, label, exact = true) {
  const locator = page.getByLabel(label, { exact }).first();
  await locator.waitFor({ state: "attached", timeout: 8_000 });
  await locator.check({ force: true, timeout: 8_000 });
}

async function fillField(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    await locator.waitFor({ state: "attached", timeout: 8_000 });
    await locator.fill(value, { timeout: 8_000 });
    return;
  }
  throw new Error("Expected quote field was not found: " + selectors.join(", "));
}

async function selectFirstMeaningfulOption(page) {
  const selects = page.locator("select:visible");
  const count = await selects.count();
  if (count === 0) {
    throw new Error("No visible income selector was found.");
  }

  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const select = selects.nth(i);
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
    if (!option) continue;
    await select.selectOption({ index: option.index });
    selected.push(option.text);
  }

  if (selected.length === 0) {
    throw new Error("Income selector had no usable option.");
  }
  return selected;
}

function extractEvidence(bodyText, hospitalProduct, extrasProduct) {
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

  const prices = [...snippet.matchAll(/\$\s?\d+(?:\.\d{2})?/g)].map((m) => m[0]);

  return {
    hospital_product_found: hospitalIndex >= 0,
    extras_product_found: extrasIndex >= 0,
    prices: [...new Set(prices)].slice(0, 10),
    evidence_snippet: snippet.slice(0, 2_500),
  };
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

  const started = Date.now();
  let browser;

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });

    context.signal?.addEventListener(
      "abort",
      () => {
        void browser?.close().catch(() => {});
      },
      { once: true },
    );

    const browserContext = await browser.newContext({
      locale: "en-AU",
      timezoneId: "Australia/Brisbane",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    });
    const page = await browserContext.newPage();

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        !isAllowedTopLevelUrl(request.url())
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await page.goto(START_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!isAllowedTopLevelUrl(page.url())) {
      return failure("UNEXPECTED_NAVIGATION", {
        code: "UNEXPECTED_NAVIGATION",
        message: "Quote flow navigated outside the allowlisted Queensland Country hosts.",
      });
    }

    try {
      await page.locator("#CoverType_family").check({ force: true });
      await page.locator("#state_QLD").check({ force: true });
      await fillField(page, ["#Member_Age", 'input[name="Member_Age"]'], SYNTHETIC_PROFILE.primary_age);

      const yesRadios = page.getByLabel("Yes", { exact: true });
      const noRadios = page.getByLabel("No", { exact: true });

      if ((await yesRadios.count()) < 2 || (await noRadios.count()) < 3) {
        throw new Error("Expected quote eligibility radio groups were not found.");
      }

      await yesRadios.nth(0).check({ force: true });
      await fillField(
        page,
        ["#Partner_Age", 'input[name="Partner_Age"]', 'input[name*="Partner"][type="number"]'],
        SYNTHETIC_PROFILE.partner_age,
      );
      await yesRadios.nth(1).check({ force: true });
      await noRadios.nth(2).check({ force: true });

      const selectedIncomeOptions = await selectFirstMeaningfulOption(page);

      await page.getByRole("button", { name: /choose cover/i }).click({
        timeout: 10_000,
      });
      await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2_000);

      const bodyText = await page.locator("body").innerText();
      const evidence = extractEvidence(
        bodyText,
        input.hospital_product,
        input.extras_product,
      );

      const exact =
        evidence.hospital_product_found &&
        evidence.extras_product_found &&
        evidence.prices.length > 0;

      return {
        ok: exact,
        state: exact ? "EXACT_QUOTE_VERIFIED" : "PARTIAL_EVIDENCE",
        profile: {
          profile_ref: SYNTHETIC_PROFILE.profile_ref,
          synthetic: true,
          selected_income_options: selectedIncomeOptions,
        },
        target: {
          hospital_product: input.hospital_product,
          extras_product: input.extras_product,
        },
        evidence,
        provenance: {
          retrieved_at: new Date().toISOString(),
          start_url: START_URL,
          final_url: page.url(),
          execution: "playwright",
        },
        diagnostics: {
          duration_ms: Date.now() - started,
        },
      };
    } catch (error) {
      const controls = await collectVisibleControls(page).catch(() => []);
      const message = error instanceof Error ? error.message : "Quote interaction failed.";
      const lower = message.toLowerCase();

      return failure(
        lower.includes("timeout") ? "UI_CHANGED" : "INTERACTION_FAILED",
        {
          code: lower.includes("timeout") ? "UI_CHANGED" : "INTERACTION_FAILED",
          message: message.slice(0, 1000),
        },
        {
          provenance: {
            retrieved_at: new Date().toISOString(),
            start_url: START_URL,
            final_url: page.url(),
            execution: "playwright",
          },
          diagnostics: {
            duration_ms: Date.now() - started,
            visible_controls: controls,
          },
        },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser execution failed.";
    return failure(
      context.signal?.aborted ? "TIMEOUT" : "BROWSER_FAILED",
      {
        code: context.signal?.aborted ? "TIMEOUT" : "BROWSER_FAILED",
        message: message.slice(0, 1000),
      },
      {
        provenance: {
          retrieved_at: new Date().toISOString(),
          start_url: START_URL,
          execution: "playwright",
        },
        diagnostics: {
          duration_ms: Date.now() - started,
        },
      },
    );
  } finally {
    await browser?.close().catch(() => {});
  }
}

export { extractEvidence, isAllowedTopLevelUrl };
