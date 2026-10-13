import { expect,test } from "bun:test";
import { nativeHelperHealthFindings } from "../../src/doctor/native-helper.js";

test("doctor distinguishes unsupported reconciliation from a missing packaged prerequisite",()=>{
 const base={platform:"win32",arch:"arm64",standalone:false,entryPath:"/missing/app.js",executablePath:"/missing/bin"};
 expect(nativeHelperHealthFindings(base)[0]?.code).toBe("doctor.reconciliation_unsupported");
 expect(nativeHelperHealthFindings({...base,platform:"linux"})[0]?.code).toBe("doctor.native_helper_unavailable");
 expect(nativeHelperHealthFindings({...base,platform:"linux"})[0]?.severity).toBe("warning");
});
