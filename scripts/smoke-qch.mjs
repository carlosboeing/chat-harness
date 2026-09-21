import { run } from "../capabilities/private-health-qch-quote/handler.mjs";

const result = await run(
  {
    profile_ref: "synthetic-family-qld-v1",
    hospital_product: "Signature Hospital (Silver+)",
    extras_product: "Select Extras",
    excess: 750,
  },
  { signal: AbortSignal.timeout(90_000) },
);

process.stdout.write(JSON.stringify(result, null, 2) + "\n");

if (result.ok !== true) {
  process.exitCode = 1;
}
