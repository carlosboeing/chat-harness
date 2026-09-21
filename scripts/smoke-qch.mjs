import { run } from "../capabilities/private-health-qch-quote/handler.mjs";

const result = await run(
  {
    profile_ref: "synthetic-family-qld-v1",
    hospital_product: "Signature Hospital (Silver+)",
    extras_product: "Select Extras",
    excess: 750,
    payment_frequency: "monthly",
  },
  { signal: AbortSignal.timeout(90_000) },
);

process.stdout.write(JSON.stringify(result, null, 2) + "\n");

if (result.ok !== true || result.state !== "EXACT_QUOTE_VERIFIED") {
  process.exitCode = 1;
}
