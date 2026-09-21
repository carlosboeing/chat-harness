const START_URL =
  "https://www.medibank.com.au/health-insurance/find-provider/";

const ALLOWED_TOP_LEVEL_HOSTS = new Set([
  "www.medibank.com.au",
  "medibank.com.au",
]);

function failure(state, message, extra = {}) {
  return {
    ok: false,
    state,
    error: {
      code: state,
      message:
        typeof message === "string"
          ? message.slice(0, 1200)
          : "Provider lookup failed.",
    },
    ...extra,
  };
}

function assertInput(input) {
  const expected = {
    provider_name: "Budi Dental",
    postcode: "4556",
    provider_type: "Dentist",
  };
  const keys = Object.keys(input ?? {}).sort();
  if (keys.join(",") !== Object.keys(expected).sort().join(",")) {
    throw new Error("Unexpected provider lookup input fields.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (input[key] !== value) {
      throw new Error("Unsupported " + key + " for this experiment.");
    }
  }
}

function isAllowedTopLevelUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && ALLOWED_TOP_LEVEL_HOSTS.has(url.hostname);
}

async function collectPageDiagnostics(page) {
  const frames = [];
  for (const frame of page.frames()) {
    frames.push({
      url: frame.url(),
      name: frame.name(),
      links: await frame
        .locator("a[href]")
        .evaluateAll((nodes) =>
          nodes
            .map((node) => ({
              text: (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 180),
              href: node.href,
              aria_label: node.getAttribute("aria-label"),
            }))
            .filter(
              (x) =>
                /provider|dentist|hospital|member/i.test(x.text) ||
                /provider|dentist|hospital|member/i.test(x.href) ||
                /provider|dentist|hospital|member/i.test(x.aria_label ?? ""),
            )
            .slice(0, 80),
        )
        .catch(() => []),
      controls: await frame
        .locator("input, button, select")
        .evaluateAll((nodes) =>
          nodes.slice(0, 80).map((node) => ({
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
                ? node.innerText.trim().slice(0, 160)
                : null,
          })),
        )
        .catch(() => []),
    });
  }
  return frames;
}

async function tryFillByHints(frame, hints, value) {
  const selectors = [];
  for (const hint of hints) {
    selectors.push(
      frame.getByLabel(hint, { exact: false }),
      frame.getByPlaceholder(hint, { exact: false }),
    );
  }

  for (const candidate of selectors) {
    if ((await candidate.count().catch(() => 0)) === 0) continue;
    const input = candidate.first();
    if (!(await input.isVisible().catch(() => false))) continue;
    await input.fill(value);
    return true;
  }
  return false;
}

function extractSnippet(bodyText, providerName) {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const index = normalized.toLowerCase().indexOf(providerName.toLowerCase());
  if (index < 0) return normalized.slice(0, 3000);
  return normalized.slice(Math.max(0, index - 700), index + 3000);
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
      () => void browser?.close().catch(() => {}),
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

    const response = await page.goto(START_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!response || response.status() >= 400) {
      return failure("FETCH_BLOCKED", "Provider finder returned HTTP " + (response?.status() ?? "unknown"), {
        provenance: {
          retrieved_at: new Date().toISOString(),
          start_url: START_URL,
          final_url: page.url(),
          execution: "playwright",
        },
        diagnostics: {
          duration_ms: Date.now() - started,
          frames: await collectPageDiagnostics(page),
        },
      });
    }

    await page.waitForTimeout(2_000);

    let interacted = false;
    for (const frame of page.frames()) {
      const typeFilled = await tryFillByHints(
        frame,
        ["provider type", "service", "dentist"],
        input.provider_type,
      );
      const postcodeFilled = await tryFillByHints(
        frame,
        ["postcode", "location", "suburb"],
        input.postcode,
      );
      const providerFilled = await tryFillByHints(
        frame,
        ["provider name", "practice", "name"],
        input.provider_name,
      );

      const searchButtons = frame.getByRole("button", {
        name: /search|find|show providers|show dentists/i,
      });
      if (
        (typeFilled || postcodeFilled || providerFilled) &&
        (await searchButtons.count().catch(() => 0)) > 0
      ) {
        await searchButtons.first().click({ timeout: 10_000 });
        interacted = true;
        break;
      }
    }

    if (!interacted) {
      return failure("UI_CHANGED", "Could not identify the Medibank provider search controls.", {
        provenance: {
          retrieved_at: new Date().toISOString(),
          start_url: START_URL,
          final_url: page.url(),
          execution: "playwright",
        },
        diagnostics: {
          duration_ms: Date.now() - started,
          frames: await collectPageDiagnostics(page),
          body_text: (await page.locator("body").innerText().catch(() => "")).slice(0, 4000),
        },
      });
    }

    await page.waitForTimeout(2_000);

    let combinedText = "";
    for (const frame of page.frames()) {
      combinedText += "\n" + (await frame.locator("body").innerText().catch(() => ""));
    }

    const found = combinedText.toLowerCase().includes(input.provider_name.toLowerCase());

    return {
      ok: found,
      state: found ? "PROVIDER_NETWORK_VERIFIED" : "PROVIDER_NOT_FOUND",
      query: input,
      evidence: {
        provider_found: found,
        evidence_snippet: extractSnippet(combinedText, input.provider_name),
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
      error instanceof Error ? error.message : "Provider lookup failed.",
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
