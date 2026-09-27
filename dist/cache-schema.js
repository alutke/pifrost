/**
 * Increment whenever cached model/diagnostic semantics change in a way that can
 * make an older catalog unsafe or hide newly-supported routes after an upgrade.
 *
 * This tiny module is intentionally dependency-free so the standalone CLI can
 * compile and consume the same schema constant as the native OMP extension.
 */
export const CATALOG_CACHE_SCHEMA_VERSION = 9;


//# sourceURL=/home/runner/work/pifrost/pifrost/cache-schema.ts