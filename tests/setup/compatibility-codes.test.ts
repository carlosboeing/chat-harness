import { expect,test } from "bun:test";
import { buildDesiredManifest,validateManifest,ManifestContractError } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE,CORE_VERSION } from "../../src/setup/templates.js";
function code(value:unknown){try{validateManifest(value);return "accepted";}catch(error){return (error as ManifestContractError).code;}}
test("manifest distinguishes corrupt, unsupported, unknown and future component states",()=>{
 const m=buildDesiredManifest("0.3.7",AGENTS_TEMPLATE,["tech"]);
 expect(code({...m,schema:99})).toBe("setup.manifest_schema_unsupported");
 expect(code({...m,core:{...m.core,version:CORE_VERSION+1}})).toBe("setup.core_version_too_new");
 expect(code({...m,specialists:{tech:{version:999}}})).toBe("setup.specialist_version_too_new");
 expect(code({...m,specialists:{unknown:{version:1}}})).toBe("setup.specialist_unknown");
 expect(code({...m,core:{version:"bad"}})).toBe("setup.manifest_invalid");
});
