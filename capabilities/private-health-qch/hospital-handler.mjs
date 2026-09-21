const START_URL =
  "https://www.queenslandcountry.health/provider-search/hospital-search-page/";

const ALLOWED_TOP_LEVEL_HOSTS = new Set([
  "www.queenslandcountry.health",
  "queenslandcountry.health",
]);

const ALLOWED_HOSPITALS = new Set([
  "Buderim Private Hospital",
  "Sunshine Coast University Private Hospital",
]);

function failure(state, message, extra = {}) {
  return {
    ok: false,
    state,
    error: {
      code: state,
      message:
        typeof message === "string"
          ? message.slice(0, 1000)
          : "Hospital lookup failed.",
    },
    ...extra,
  };
}

function assertInput(input) {
  const keys = Object.keys(input ?? {});
  if (keys.length !== 1 || keys[0] !== "hospital_name") {
    throw new Error("Input must contain only hospital_name.");
  }
  if (!ALLOWED_HOSPITALS.has(input.hospital_name)) {
    throw new Error("Hospital is not allowlisted for this experiment.");
  }
}

function isAllowedTopLevelUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && ALLOWED_TOP_LEVEL_HOSTS.has(url.hostname);
}

async function collectControls(page) {
  return page
    .locator("input, button, select")
    .evaluateAll((nodes) =>
      nodes.slice(0, 60).map((node) => ({
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute("type"),
        name: node.getAttribute("name"),
        id: node.id || null,
        placeholder: node.getAttribute("placeholder"),
        aria_label: node.getAttribute("aria-label"),
        labels: node.labels
          ? Array.from(node.labels)
              .map((label) => label.innerText.trim())
              .filter(Boolean)
          : [],
        text:
          node.tagName === "BUTTON"
            ? node.innerText.trim().slice(0, 120)
            : null,
      })),
    );
}

async function fillHospitalName(page, value) {
  const candidates = [
    page.getByLabel("Provider Name", { exact: true }),
    page.locator('input[name*="Provider" i]'),
    page.locator('input[id*="Provider" i]'),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) continue;
    const input = candidate.first();
    await input.waitFor({ state: "attached", timeout: 8_000 });
    await input.fill(value);
    return;
  }

  throw new Error("Provider Name input was not found.");
}

function extractSnippet(bodyText, hospitalName) {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const index = lower.indexOf(hospitalName.toLowerCase());
  if (index < 0) return normalized.slice(0, 2500);
  return normalized.slice(Math.max(0, index - 500), index + 2500);
}

export async function run(input, context = {}) {
  try {
    assertInput(input);
  } catch (error) {
    return failure(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid input.",
    );
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

    await fillHospitalName(page, input.hospital_name);

    const findButton = page.getByRole("button", { name: /^Find$/i }).first();
    if ((await findButton.count()) === 0) {
      throw new Error("Find button was not found.");
    }

    await findButton.click({ timeout: 10_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    const bodyText = await page.locator("body").innerText();
    const found = bodyText
      .toLowerCase()
      .includes(input.hospital_name.toLowerCase());

    return {
      ok: found,
      state: found ? "HOSPITAL_NETWORK_LISTED" : "HOSPITAL_NOT_FOUND",
      query: {
        hospital_name: input.hospital_name,
      },
      evidence: {
        hospital_found: found,
        evidence_snippet: extractSnippet(bodyText, input.hospital_name),
      },
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
    return failure(
      context.signal?.aborted ? "TIMEOUT" : "UI_CHANGED",
      error instanceof Error ? error.message : "Hospital lookup failed.",
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

export { extractSnippet, isAllowedTopLevelUrl };
