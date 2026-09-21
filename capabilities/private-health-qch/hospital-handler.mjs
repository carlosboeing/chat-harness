const START_URL =
  "https://www.queenslandcountry.health/provider-search/hospital-search-page/";

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

function buildLookupUrl(hospitalName) {
  const url = new URL(START_URL);
  url.searchParams.set("lat", "undefined");
  url.searchParams.set("lng", "undefined");
  url.searchParams.set("gps", "0");
  url.searchParams.set("location", "");
  url.searchParams.set("name", hospitalName);
  return url;
}

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSnippet(text, hospitalName) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(hospitalName.toLowerCase());
  if (index < 0) return text.slice(0, 2500);
  return text.slice(Math.max(0, index - 500), index + 2500);
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
  const url = buildLookupUrl(input.hospital_name);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; ChatGPTCapabilityBridge/1.0; +https://github.com/)",
      },
      redirect: "error",
      signal: context.signal,
    });

    if (!response.ok) {
      return failure(
        "HTTP_ERROR",
        "Hospital search returned HTTP " + response.status + ".",
        {
          provenance: {
            retrieved_at: new Date().toISOString(),
            source_url: url.toString(),
            execution: "http",
          },
          diagnostics: {
            duration_ms: Date.now() - started,
            http_status: response.status,
          },
        },
      );
    }

    const html = await response.text();
    const text = htmlToText(html);
    const found = text
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
        evidence_snippet: extractSnippet(text, input.hospital_name),
      },
      provenance: {
        retrieved_at: new Date().toISOString(),
        source_url: url.toString(),
        execution: "http",
      },
      diagnostics: {
        duration_ms: Date.now() - started,
        http_status: response.status,
      },
    };
  } catch (error) {
    return failure(
      context.signal?.aborted ? "TIMEOUT" : "FETCH_FAILED",
      error instanceof Error ? error.message : "Hospital lookup failed.",
      {
        provenance: {
          retrieved_at: new Date().toISOString(),
          source_url: url.toString(),
          execution: "http",
        },
        diagnostics: {
          duration_ms: Date.now() - started,
        },
      },
    );
  }
}

export { buildLookupUrl, extractSnippet, htmlToText };
