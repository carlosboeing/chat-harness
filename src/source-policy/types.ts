export type SourcePrivacy =
  | "public"
  | "personal"
  | "confidential"
  | "restricted";

export interface SourcePolicyRule {
  match: {
    path: string;
  };
  privacy: SourcePrivacy;
}

export interface SourcePolicyV1 {
  version: 1;
  defaults?: {
    privacy: SourcePrivacy;
  };
  rules?: SourcePolicyRule[];
}

export type SourcePolicyResolution =
  | {
      state: "resolved";
      privacy: SourcePrivacy;
      matchedBy: "default" | "exact" | "subtree";
      matchedPath?: string;
    }
  | {
      state: "absent";
      code: "source_policy.absent";
      reason: string;
    }
  | {
      state: "unavailable";
      code:
        | "source_policy.invalid"
        | "source_policy.unsupported_version"
        | "source_policy.unreadable"
        | "source_policy.rule_conflict";
      reason: string;
    };
