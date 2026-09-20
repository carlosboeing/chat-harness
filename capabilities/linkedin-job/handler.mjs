const JOB_ID_RE = /^[0-9]{6,20}$/;
const MAX_RESPONSE_CHARS = 2_000_000;
const MAX_DESCRIPTION_CHARS = 20_000;

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtmlFragment(value) {
  if (!value) return null;

  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const decoded = decodeHtml(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decoded || null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function extractByClass(html, className) {
  const escaped = escapeRegex(className);
  const pattern = new RegExp(
    "<([a-zA-Z0-9]+)\\b[^>]*class=[\"'][^\"']*" +
      escaped +
      "[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/\\1>",
    "i",
  );
  const match = html.match(pattern);
  return cleanHtmlFragment(match?.[2] ?? "");
}

function firstNonEmpty(...values) {
  return values.find((value) => value && value.trim()) ?? null;
}

function observedJobIds(html) {
  const ids = new Set();
  const patterns = [
    /\/jobs\/view\/(\d+)/g,
    /jobPosting[:/](\d+)/g,
    /urn:li:jobPosting:(\d+)/g,
    /currentJobId=(\d+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }

  return [...ids].sort();
}

export function parseLinkedInJobHtml(html, expectedJobId) {
  const title = firstNonEmpty(
    extractByClass(html, "top-card-layout__title"),
    extractByClass(html, "topcard__title"),
  );

  const company = firstNonEmpty(
    extractByClass(html, "topcard__org-name-link"),
    extractByClass(html, "top-card-layout__entity-info"),
  );

  const location = firstNonEmpty(
    extractByClass(html, "topcard__flavor--bullet"),
    extractByClass(html, "top-card-layout__second-subline"),
  );

  const description = firstNonEmpty(
    extractByClass(html, "show-more-less-html__markup"),
    extractByClass(html, "description__text"),
    extractByClass(html, "show-more-less-html"),
  );

  const ids = observedJobIds(html);

  return {
    title,
    company,
    location,
    description: description?.slice(0, MAX_DESCRIPTION_CHARS) ?? null,
    description_chars: description?.length ?? 0,
    observed_job_ids: ids,
    exact_job_id_match: ids.length > 0 ? ids.includes(expectedJobId) : null,
  };
}

function allowedLinkedInUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return host === "linkedin.com" || host === "www.linkedin.com" || host.endsWith(".linkedin.com");
}

async function fetchWithRestrictedRedirects(initialUrl, signal) {
  let current = initialUrl;

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!allowedLinkedInUrl(current)) {
      throw new Error("LinkedIn handler refused a redirect outside the allowlisted domain.");
    }

    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/153.0.0.0 Safari/537.36",
        "accept-language": "en-AU,en;q=0.9",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;

      current = new URL(location, current).toString();
      continue;
    }

    return response;
  }

  throw new Error("LinkedIn handler exceeded the redirect limit.");
}

function failure(state, jobId, guestUrl, extra = {}) {
  return {
    ok: false,
    state,
    identity: {
      expected_job_id: jobId,
      observed_job_ids: [],
      exact_match: false,
    },
    resource: {
      canonical_url: "https://www.linkedin.com/jobs/view/" + jobId,
      guest_url: guestUrl,
    },
    ...extra,
  };
}

export async function run(input) {
  const jobId = input?.job_id;

  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) {
    return {
      ok: false,
      state: "INVALID_INPUT",
      error: {
        code: "INVALID_JOB_ID",
        message: "job_id must be a 6-20 digit string.",
      },
    };
  }

  if (Object.keys(input).some((key) => key !== "job_id")) {
    return {
      ok: false,
      state: "INVALID_INPUT",
      error: {
        code: "UNEXPECTED_INPUT",
        message: "linkedin.job.lookup accepts only job_id.",
      },
    };
  }

  const guestUrl =
    "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/" + jobId;
  const startedAt = new Date().toISOString();

  let response;
  try {
    response = await fetchWithRestrictedRedirects(
      guestUrl,
      AbortSignal.timeout(15_000),
    );
  } catch (error) {
    return failure("FETCH_FAILED", jobId, guestUrl, {
      error: {
        code: "FETCH_FAILED",
        message: error instanceof Error ? error.message : "LinkedIn fetch failed.",
      },
      provenance: { retrieved_at: startedAt },
    });
  }

  const provenance = {
    retrieved_at: new Date().toISOString(),
    http_status: response.status,
    final_url: response.url || guestUrl,
  };

  if (response.status === 404 || response.status === 410) {
    return failure("LIKELY_EXPIRED_OR_REMOVED", jobId, guestUrl, { provenance });
  }

  if (response.status === 429) {
    return failure("RATE_LIMITED", jobId, guestUrl, { provenance });
  }

  if (response.status === 401 || response.status === 403) {
    return failure("BLOCKED", jobId, guestUrl, { provenance });
  }

  if (!response.ok) {
    return failure("HTTP_ERROR", jobId, guestUrl, {
      provenance,
      error: {
        code: "HTTP_" + response.status,
        message: "LinkedIn returned HTTP " + response.status + ".",
      },
    });
  }

  const html = await response.text();
  provenance.body_chars = html.length;

  if (html.length > MAX_RESPONSE_CHARS) {
    return failure("RESPONSE_TOO_LARGE", jobId, guestUrl, { provenance });
  }

  const parsed = parseLinkedInJobHtml(html, jobId);

  if (parsed.exact_job_id_match === false) {
    return {
      ok: false,
      state: "IDENTITY_MISMATCH",
      identity: {
        expected_job_id: jobId,
        observed_job_ids: parsed.observed_job_ids,
        exact_match: false,
      },
      resource: {
        canonical_url: "https://www.linkedin.com/jobs/view/" + jobId,
        guest_url: guestUrl,
        title: parsed.title,
        company: parsed.company,
        location: parsed.location,
      },
      provenance,
    };
  }

  const substantive =
    Boolean(parsed.title) &&
    Boolean(parsed.description) &&
    parsed.description_chars >= 100;

  if (!substantive) {
    return {
      ok: false,
      state: "PARTIAL_EVIDENCE",
      identity: {
        expected_job_id: jobId,
        observed_job_ids: parsed.observed_job_ids,
        exact_match: parsed.exact_job_id_match,
      },
      resource: {
        canonical_url: "https://www.linkedin.com/jobs/view/" + jobId,
        guest_url: guestUrl,
        title: parsed.title,
        company: parsed.company,
        location: parsed.location,
        description: parsed.description,
        description_chars: parsed.description_chars,
      },
      provenance,
    };
  }

  return {
    ok: true,
    state: "EXACT_VERIFIED",
    identity: {
      expected_job_id: jobId,
      observed_job_ids: parsed.observed_job_ids,
      exact_match: parsed.exact_job_id_match,
      basis:
        parsed.exact_job_id_match === true
          ? "guest_endpoint_key_and_payload_id"
          : "guest_endpoint_key",
    },
    resource: {
      canonical_url: "https://www.linkedin.com/jobs/view/" + jobId,
      guest_url: guestUrl,
      title: parsed.title,
      company: parsed.company,
      location: parsed.location,
      description: parsed.description,
      description_chars: parsed.description_chars,
    },
    provenance,
  };
}
