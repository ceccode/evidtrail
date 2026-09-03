// Output schema versioning (#53).
//
// `commit-stream.json` and `metrics.json` are consumed by CI pipelines and
// scripts outside this repo. Their shape has changed repeatedly (three-state
// attribution, manifest sources, cohorts, autonomy mode, automated state,
// merge-ratio removal) and a consumer had no way to detect it: a stale file
// parsed against a newer schema yields silent `undefined`s, not an error.
//
// The contract:
//   - Additive changes (new optional field) do NOT bump the version.
//   - Removing a field, renaming it, or changing the meaning of an existing
//     one DOES bump it.
//   - Readers refuse a version they don't understand, with a fix in the
//     message, instead of parsing it half-way.
// v2 (#25): `tags` is now two orthogonal axes — `mode` (involvement) and
// `evidence` (how we know) — with `attribution` demoted to a derived
// projection of them. `modeEvidence` was renamed `evidence`, `automated`
// became its own boolean, and the redundant `ai` boolean was dropped.
// v3 (pre-1.0 audit): collection scope and snapshot HEAD are explicit. The
// default scope changed from every local/remote ref to default-branch history.
export const COMMIT_STREAM_SCHEMA_VERSION = 3;
// v2 (#25): coverage is measured on the evidence axis, and the prior is
// `defaultMode` (an autonomy level) rather than `defaultAttribution`.
// v3: scope/snapshot metadata and fixed-horizon rapid-retouch semantics.
export const METRICS_SCHEMA_VERSION = 3;

export class SchemaVersionError extends Error {
  constructor(
    readonly filePath: string,
    readonly found: unknown,
    readonly expected: number,
    remedy: string
  ) {
    const foundLabel =
      typeof found === 'number' ? `schema v${found}` : 'no schemaVersion field (pre-v1 output)';
    super(
      `${filePath} has ${foundLabel}, but this version of evidtrail reads schema v${expected}. ${remedy}`
    );
    this.name = 'SchemaVersionError';
  }
}

// Checks the version field before schema parsing, so an incompatible file
// produces an actionable message rather than a wall of zod issues.
export function assertSchemaVersion(
  data: unknown,
  expected: number,
  filePath: string,
  remedy: string
): void {
  const found =
    data && typeof data === 'object' ? (data as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (found !== expected) {
    throw new SchemaVersionError(filePath, found, expected, remedy);
  }
}
