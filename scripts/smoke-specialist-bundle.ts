import { createHash } from "node:crypto";
import { SPECIALIST_ASSETS } from "../src/specialists/embedded-assets.js";
import { SPECIALIST_IDS, SPECIALISTS, composeSpecialistWorkspace,
  validateSpecialistRegistry } from "../src/specialists/definitions.js";

const errors = validateSpecialistRegistry();
if (errors.length) throw new Error(errors.join("; "));

const digest = createHash("sha256")
  .update(SPECIALIST_IDS.map(id => SPECIALISTS[id].workspaceFragment).join("\n"))
  .update(SPECIALISTS.shopping.procedures!.map(p => p.content).join("\n"))
  .digest("hex");

process.stdout.write(JSON.stringify({
  count: SPECIALIST_IDS.length,
  assets: Object.keys(SPECIALIST_ASSETS).length,
  procedurePaths: SPECIALISTS.shopping.procedures!.map(p => p.path),
  careerRecommended: SPECIALISTS.career.capabilities?.recommended,
  zeroSpecialistOutput: composeSpecialistWorkspace([]).includes("## Specialist — "),
  digest,
}) + "\n");
