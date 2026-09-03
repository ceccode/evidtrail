import { describe, it, expect } from 'vitest';
import { SchemaVersionError, assertSchemaVersion } from './version.js';

describe('assertSchemaVersion', () => {
  it('accepts a matching version', () => {
    expect(() => assertSchemaVersion({ schemaVersion: 1 }, 1, 'f.json', 'Rerun.')).not.toThrow();
  });

  it('rejects an older version with an actionable message', () => {
    expect(() => assertSchemaVersion({ schemaVersion: 1 }, 2, 'metrics.json', 'Rerun x.')).toThrow(
      /metrics\.json has schema v1, but this version of evidtrail reads schema v2\. Rerun x\./
    );
  });

  it('rejects a newer version too — a consumer must not half-parse it', () => {
    expect(() => assertSchemaVersion({ schemaVersion: 5 }, 2, 'f.json', 'Rerun.')).toThrow(
      SchemaVersionError
    );
  });

  it('names the pre-versioning case explicitly when the field is absent', () => {
    expect(() => assertSchemaVersion({ commits: [] }, 1, 'commit-stream.json', 'Rerun y.')).toThrow(
      /no schemaVersion field \(pre-v1 output\).*Rerun y\./
    );
  });

  it('rejects non-object input without crashing', () => {
    expect(() => assertSchemaVersion(null, 1, 'f.json', 'Rerun.')).toThrow(SchemaVersionError);
    expect(() => assertSchemaVersion('nope', 1, 'f.json', 'Rerun.')).toThrow(SchemaVersionError);
  });
});
