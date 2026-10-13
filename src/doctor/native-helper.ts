import type { Finding } from "../cli/result.js";
import { verifiedMacosHelper,MacosHelperError,type MacosHelperRuntime } from "../workspace/macos-helper.js";
/** Probe only the packaged read-only protocol; never changes a Workspace. */
export function nativeHelperHealthFindings(runtime?:MacosHelperRuntime):Finding[]{
 try{verifiedMacosHelper(runtime);return [];}catch(error){
  return [{code:error instanceof MacosHelperError && error.code==="unsupported"?"doctor.reconciliation_unsupported":"doctor.native_helper_unavailable",
   severity:"warning",location:"native filesystem backend",message:String(error),
   remediation:"Read-only diagnosis remains available. Use a complete qualified distribution for reconciliation; source-checkout execution has no native-helper fallback."}];
 }
}
