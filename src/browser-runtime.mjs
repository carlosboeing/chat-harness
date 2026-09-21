import { chromium } from "playwright";

const DEFAULT_ACTION_TIMEOUT_MS = 8_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ACTIONS = 40;

function hostnameAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase();

  return allowedHosts.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === normalized;
  });
}

export function isAllowedTopLevelUrl(value, allowedHosts) {
  if (value === "about:blank") return true;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    Array.isArray(allowedHosts) &&
    hostnameAllowed(url.hostname, allowedHosts)
  );
}

export function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export class BrowserPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserPolicyError";
    this.code = code;
  }
}

export async function withBrowserTask(
  {
    signal,
    allowedHosts,
    locale = "en-AU",
    timezoneId = "Australia/Brisbane",
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
    maxActions = DEFAULT_MAX_ACTIONS,
  },
  task,
) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new BrowserPolicyError(
      "MISSING_ALLOWLIST",
      "Browser capability requires an explicit top-level navigation allowlist.",
    );
  }

  const startedAt = Date.now();
  let steps = 0;
  const browser = await chromium.launch({ headless: true });
  let context;

  try {
    context = await browser.newContext({
      locale,
      timezoneId,
      serviceWorkers: "block",
    });

    await context.route("**/*", async (route) => {
      const request = route.request();

      if (
        request.isNavigationRequest() &&
        request.frame() === request.frame().page()?.mainFrame?.()
      ) {
        const target = request.url();
        if (!isAllowedTopLevelUrl(target, allowedHosts)) {
          await route.abort("blockedbyclient");
          return;
        }
      }

      await route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(actionTimeoutMs);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    const closeOnAbort = () => {
      void page.close({ runBeforeUnload: false }).catch(() => {});
    };
    signal?.addEventListener("abort", closeOnAbort, { once: true });

    async function step(name, fn) {
      if (signal?.aborted) {
        throw new BrowserPolicyError(
          "ABORTED",
          "Browser capability was aborted before step " + name + ".",
        );
      }

      steps += 1;
      if (steps > maxActions) {
        throw new BrowserPolicyError(
          "ACTION_BUDGET_EXCEEDED",
          "Browser capability exceeded its action budget.",
        );
      }

      return await fn();
    }

    async function safeGoto(url) {
      if (!isAllowedTopLevelUrl(url, allowedHosts)) {
        throw new BrowserPolicyError(
          "NAVIGATION_BLOCKED",
          "Top-level navigation target is not allowlisted.",
        );
      }

      return await step("navigate", () =>
        page.goto(url, { waitUntil: "domcontentloaded" }),
      );
    }

    try {
      const result = await task({ page, step, safeGoto });
      return {
        result,
        diagnostics: {
          execution: "playwright",
          browser: "chromium",
          duration_ms: Date.now() - startedAt,
          steps,
          final_url: sanitizeUrl(page.url()),
        },
      };
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
    }
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
