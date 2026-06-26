/**
 * Runtime application version — distinct from NEXORA_VERSION (plugin contract).
 *
 * APP_VERSION = the shipped release tag (semver). Used by:
 *   - boot banner
 *   - GET /api/version
 *   - update checker (compare against FileServer's latest)
 *   - migration lock (refuse downgrade if DB schema_version > code expects)
 *
 * Bumped per release via scripts/release.ts. Single source of truth.
 */
export const APP_VERSION = "1.0.0";

/**
 * Highest migration index this build knows how to run.
 * Equal to the highest numeric prefix in backend/src/db/migrations/.
 * Refuse to boot if DB recorded a higher index — that means the operator
 * pulled an older image after the DB was migrated by a newer one.
 */
export const SCHEMA_VERSION = 12;
