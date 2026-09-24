import { chromium, type Page } from "playwright";

const DEFAULT_ACTION_TIMEOUT_MS = 8_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ACTIONS = 40;

function hostnameAllowed(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
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

export function isAllowedTopLevelUrl(
  value: string,
  allowedHosts: readonly string[],
): boolean {
  if (value === "about:blank") return true;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    allowedHosts.length > 0 &&
    hostnameAllowed(url.hostname, allowedHosts)
  );
}

export function sanitizeUrl(value: string): string | null {
  if (value === "about:blank") return value;
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export class BrowserPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserPolicyError";
  }
}

function diagnosticsFor(
  page: Page | undefined,
  startedAt: number,
  steps: number,
) {
  return {
    execution: "playwright",
    browser: "chromium",
    duration_ms: Date.now() - startedAt,
    steps,
    final_url: sanitizeUrl(page?.url() ?? ""),
  };
}

export interface BrowserTaskOptions {
  signal?: AbortSignal;
  allowedHosts: string[];
  locale?: string;
  timezoneId?: string;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  maxActions?: number;
}

export interface BrowserTaskContext {
  page: Page;
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  safeGoto(url: string): Promise<unknown>;
}

export async function withBrowserTask<T>(
  {
    signal,
    allowedHosts,
    locale = "en-AU",
    timezoneId = "Australia/Brisbane",
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
    maxActions = DEFAULT_MAX_ACTIONS,
  }: BrowserTaskOptions,
  task: (context: BrowserTaskContext) => Promise<T>,
): Promise<{
  result: T;
  diagnostics: ReturnType<typeof diagnosticsFor>;
}> {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new BrowserPolicyError(
      "MISSING_ALLOWLIST",
      "Browser capability requires an explicit top-level navigation allowlist.",
    );
  }

  const startedAt = Date.now();
  let steps = 0;
  const browser = await chromium.launch({ headless: true });
  let page: Page | undefined;
  const context = await browser.newContext({
    locale,
    timezoneId,
    serviceWorkers: "block",
  });

  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame().parentFrame() === null &&
        !isAllowedTopLevelUrl(request.url(), allowedHosts)
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    page = await context.newPage();
    page.setDefaultTimeout(actionTimeoutMs);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);

    const closeOnAbort = () => {
      void page?.close({ runBeforeUnload: false }).catch(() => undefined);
    };
    signal?.addEventListener("abort", closeOnAbort, { once: true });

    async function step<TStep>(
      name: string,
      operation: () => Promise<TStep>,
    ): Promise<TStep> {
      if (signal?.aborted) {
        throw new BrowserPolicyError(
          "ABORTED",
          `Browser capability was aborted before step ${name}.`,
        );
      }

      steps += 1;
      if (steps > maxActions) {
        throw new BrowserPolicyError(
          "ACTION_BUDGET_EXCEEDED",
          "Browser capability exceeded its action budget.",
        );
      }
      return await operation();
    }

    async function safeGoto(url: string): Promise<unknown> {
      if (!isAllowedTopLevelUrl(url, allowedHosts)) {
        throw new BrowserPolicyError(
          "NAVIGATION_BLOCKED",
          "Top-level navigation target is not allowlisted.",
        );
      }
      return await step("navigate", () =>
        page!.goto(url, { waitUntil: "domcontentloaded" }),
      );
    }

    try {
      const result = await task({ page, step, safeGoto });
      return {
        result,
        diagnostics: diagnosticsFor(page, startedAt, steps),
      };
    } catch (error) {
      if (error && typeof error === "object") {
        Object.assign(error, {
          browserDiagnostics: diagnosticsFor(page, startedAt, steps),
        });
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
