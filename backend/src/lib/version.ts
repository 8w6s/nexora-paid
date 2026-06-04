/**
 * Single source of truth for the Nexora runtime version.
 *
 * Plugins declare `nexoraVersion: ">=0.2 <0.3"` in their manifest; the loader
 * compares against `NEXORA_VERSION` using `semver.satisfies`. Bump this when
 * the plugin contract or any exported core symbol changes in a way that
 * could break existing plugins.
 */
export const NEXORA_VERSION = "0.2.0";
