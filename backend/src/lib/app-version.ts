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
// Workflow bakes the real release tag into NEXORA_APP_VERSION at build
// time (release.yml + customer-build.yml). Fallback "0.0.0-dev" only
// fires when the binary runs without an env (local `bun run dev`).
export const APP_VERSION = (process.env.NEXORA_APP_VERSION ?? "0.0.0-dev").trim();

/**
 * Highest migration index this build knows how to run.
 * Equal to the highest numeric prefix in backend/src/db/migrations/.
 * Refuse to boot if DB recorded a higher index — that means the operator
 * pulled an older image after the DB was migrated by a newer one.
 */
export const SCHEMA_VERSION = 12;
