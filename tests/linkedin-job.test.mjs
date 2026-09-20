import test from "node:test";
import assert from "node:assert/strict";
import { parseLinkedInJobHtml } from "../capabilities/linkedin-job/handler.mjs";

test("parses exact LinkedIn guest job identity and fields", () => {
  const html = `
    <section>
      <h2 class="top-card-layout__title topcard__title">Principal Engineer</h2>
      <a class="topcard__org-name-link">Australian Broadcasting Corporation (ABC)</a>
      <span class="topcard__flavor topcard__flavor--bullet">Sydney, New South Wales, Australia</span>
      <div class="show-more-less-html__markup">
        <p>Lead principal-level engineering work across important systems.</p>
        <p>Build reliable platforms and guide technical direction.</p>
      </div>
      <a href="/jobs/view/4468897387">same job</a>
    </section>
  `;

  const parsed = parseLinkedInJobHtml(html, "4468897387");

  assert.equal(parsed.title, "Principal Engineer");
  assert.equal(parsed.company, "Australian Broadcasting Corporation (ABC)");
  assert.equal(parsed.location, "Sydney, New South Wales, Australia");
  assert.match(parsed.description, /principal-level engineering/);
  assert.deepEqual(parsed.observed_job_ids, ["4468897387"]);
  assert.equal(parsed.exact_job_id_match, true);
});

test("detects identity mismatch", () => {
  const html = `
    <h2 class="top-card-layout__title">Wrong Job</h2>
    <div class="show-more-less-html__markup">
      This deliberately contains enough descriptive text to represent a substantive but wrong job payload.
      It must never be treated as the requested resource when the stable identifier differs.
    </div>
    <a href="/jobs/view/1111111111">different job</a>
  `;

  const parsed = parseLinkedInJobHtml(html, "4468897387");
  assert.equal(parsed.exact_job_id_match, false);
  assert.deepEqual(parsed.observed_job_ids, ["1111111111"]);
});
