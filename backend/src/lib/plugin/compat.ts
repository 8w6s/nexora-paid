import semver from "semver";

export interface CompatResult {
  ok: boolean;
  reason?: string;
}

/**
 * True iff the running Nexora version satisfies the plugin's declared range.
 * Invalid ranges (typo in manifest) fail closed with a useful reason.
 */
export function checkCompat(nexoraVersion: string, range: string): CompatResult {
  if (!semver.validRange(range))
    return { ok: false, reason: `invalid nexoraVersion range: "${range}"` };
  if (!semver.valid(semver.coerce(nexoraVersion)))
    return { ok: false, reason: `bad NEXORA_VERSION: ${nexoraVersion}` };
  const ok = semver.satisfies(semver.coerce(nexoraVersion)!, range);
  return ok ? { ok: true } : { ok: false, reason: `${nexoraVersion} does not satisfy ${range}` };
}
