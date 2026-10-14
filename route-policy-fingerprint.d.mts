/** Canonical Bifrost management routing-policy hashes. No key values logged. */
export declare function routePolicyFingerprint(rules: readonly unknown[]): string;
export declare function routePolicyDrift(localHash: unknown, remoteHash: unknown): "verified-match" | "drifted" | "unverified";
