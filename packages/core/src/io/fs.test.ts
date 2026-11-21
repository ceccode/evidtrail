import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import { readVersionedJSON } from './fs.js';
import { SchemaVersionError } from '../schema/version.js';

const Artifact = z.object({ schemaVersion: z.number(), items: z.array(z.string()).default([]) });

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(content: unknown): string {
  dir = mkdtempSync(join(tmpdir(), 'evidtrail-fs-test-'));
  const path = join(dir, 'metrics.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('readVersionedJSON', () => {
  it('parses a file of the expected version, applying schema defaults', async () => {
    const path = write({ schemaVersion: 4 });
    await expect(readVersionedJSON(path, Artifact, 4, 'Rerun.')).resolves.toEqual({
      schemaVersion: 4,
      items: [],
    });
  });

  // An old artifact must be refused before the schema sees it: zod would
  // report missing fields, and the reader would not learn that rerunning one
  // command fixes it. The message names the file, not the full path.
  it('refuses another version with the file name and the remedy, before parsing', async () => {
    const path = write({ schemaVersion: 3, items: 'not an array' });
    const read = readVersionedJSON(path, Artifact, 4, "Rerun 'evidtrail analyze'.");
    await expect(read).rejects.toBeInstanceOf(SchemaVersionError);
    await expect(read).rejects.toThrow(
      "metrics.json has schema v3, but this version of evidtrail reads schema v4. Rerun 'evidtrail analyze'."
    );
  });
});
