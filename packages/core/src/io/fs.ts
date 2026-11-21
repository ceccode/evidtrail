import { promises as fs } from 'fs';
import { basename, dirname } from 'path';
import type { ZodType, ZodTypeDef } from 'zod';
import { assertSchemaVersion } from '../schema/version.js';

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

export async function writeJSON(filePath: string, data: unknown): Promise<void> {
  await ensureDir(dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readJSON<T>(filePath: string, schema?: ZodType<T>): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);
  if (schema) {
    return schema.parse(data);
  }
  return data as T;
}

// Reads an evidtrail artifact. The version is checked before the schema, so
// an incompatible file gets an actionable message instead of a wall of zod
// issues (#53).
export async function readVersionedJSON<T>(
  filePath: string,
  // The input side is `unknown`: schemas with defaults accept less than they return
  schema: ZodType<T, ZodTypeDef, unknown>,
  expectedVersion: number,
  remedy: string
): Promise<T> {
  const raw = await readJSON<unknown>(filePath);
  assertSchemaVersion(raw, expectedVersion, basename(filePath), remedy);
  return schema.parse(raw);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
