import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AIMode, AITagResult, tagFromAxes } from './ai-tags.js';
import { Logger } from '../utils/log.js';

export const MANIFEST_FILENAME = 'evidtrail-attribution.json';
// Pre-rename name, read for one release: a manifest is retroactive evidence,
// and losing it on upgrade would turn declared commits back into unknown.
export const LEGACY_MANIFEST_FILENAME = 'aida-attribution.json';

const ManifestMode = z.enum(['autocomplete', 'assisted', 'agent']);

const ManifestEntry = z.object({
  hash: z.string().min(7),
  message: z.string().optional(), // documentation only, not matched
  reason: z.string().optional(),
  // Autonomy mode for this entry (#25); overrides the manifest-level default
  mode: ManifestMode.optional(),
});

export const AttributionManifest = z.object({
  version: z.string(),
  description: z.string().optional(),
  note: z.string().optional(),
  tool: z.string().optional(),
  model: z.string().optional(),
  // Manifest-level default mode for ai_assisted_commits (#25). A manifest
  // mode is a declaration: evidence 'declared'.
  mode: ManifestMode.optional(),
  ai_assisted_commits: z.array(ManifestEntry).default([]),
  human_authored_commits: z.array(ManifestEntry).default([]),
  excluded_commits: z.array(ManifestEntry).default([]),
});

export type AttributionManifest = z.infer<typeof AttributionManifest>;

// Hash-indexed view of a manifest for O(1) lookup during collect.
// For ai entries the value is the declared mode (entry-level beats
// manifest-level default), or null when the manifest declares no mode.
export interface ManifestIndex {
  ai: Map<string, AIMode | null>;
  human: Set<string>;
  excluded: Set<string>;
  // Hashes seen during collect, to report manifest entries that matched nothing
  matched: Set<string>;
}

export function indexManifest(manifest: AttributionManifest): ManifestIndex {
  return {
    ai: new Map(
      manifest.ai_assisted_commits.map((e) => [e.hash, e.mode ?? manifest.mode ?? null])
    ),
    human: new Set(manifest.human_authored_commits.map((e) => e.hash)),
    excluded: new Set(manifest.excluded_commits.map((e) => e.hash)),
    matched: new Set(),
  };
}

// Loads <repoPath>/evidtrail-attribution.json. Missing file → null (manifest is
// optional). Invalid file → warning, null: a broken manifest must never make
// collect fail.
export async function loadAttributionManifest(
  repoPath: string,
  logger?: Logger
): Promise<AttributionManifest | null> {
  let raw: string | null = null;
  for (const name of [MANIFEST_FILENAME, LEGACY_MANIFEST_FILENAME]) {
    try {
      raw = await readFile(join(repoPath, name), 'utf-8');
    } catch {
      continue;
    }
    if (name === LEGACY_MANIFEST_FILENAME) {
      logger?.warn(
        `${LEGACY_MANIFEST_FILENAME} is the pre-rename manifest name and will stop being read in the next major — rename it to ${MANIFEST_FILENAME}.`
      );
    }
    break;
  }
  if (raw === null) return null; // no manifest — the common case

  try {
    const manifest = AttributionManifest.parse(JSON.parse(raw));
    logger?.info(
      `Attribution manifest loaded: ${manifest.ai_assisted_commits.length} ai, ` +
        `${manifest.human_authored_commits.length} human, ` +
        `${manifest.excluded_commits.length} excluded`
    );
    return manifest;
  } catch (error) {
    logger?.warn(
      `Ignoring invalid ${MANIFEST_FILENAME}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    );
    return null;
  }
}

// Applies manifest declarations on top of the heuristic tag result.
// Precedence: in-commit evidence beats retroactive declarations, except
// 'excluded', which always wins (it exists precisely to correct heuristic
// false positives like automated release commits).
export function applyManifest(
  heuristic: AITagResult,
  hash: string,
  index: ManifestIndex,
  logger?: Logger
): AITagResult {
  if (index.excluded.has(hash)) {
    index.matched.add(hash);
    // Excluded = declared automation (#39): provenance known, no cohort
    return tagFromAxes(
      { mode: 'none', evidence: 'declared', automated: true },
      'none',
      [...heuristic.sources, 'manifest:excluded']
    );
  }

  if (index.ai.has(hash)) {
    index.matched.add(hash);
    const declaredMode = index.ai.get(hash) ?? null;
    // Precedence on the mode axis: a declared mode beats heuristic
    // inference; without one, keep whatever the heuristics inferred from
    // tool identity. When neither names a level, the manifest has still
    // *declared* that AI participated — the provenance is known, only its
    // granularity is missing, so the evidence is 'declared' with an unknown
    // mode rather than no evidence at all (#25).
    const mode = declaredMode ?? heuristic.mode;
    const evidence = declaredMode
      ? 'declared'
      : heuristic.mode === 'unknown'
        ? 'declared'
        : heuristic.evidence;
    return tagFromAxes({ mode, evidence, automated: false }, 'explicit', [
      ...heuristic.sources,
      'manifest',
    ]);
  }

  if (index.human.has(hash)) {
    index.matched.add(hash);
    if (heuristic.attribution === 'ai') {
      // The commit itself carries an AI signal: in-commit evidence wins.
      logger?.warn(
        `Manifest declares ${hash.slice(0, 8)} human, but the commit has an explicit AI signal (${heuristic.sources.join(', ')}) — keeping ai`
      );
      return heuristic;
    }
    // A human declaration is a mode declaration: no AI participated
    return tagFromAxes({ mode: 'none', evidence: 'declared', automated: false }, heuristic.level, [
      ...heuristic.sources,
      'manifest',
    ]);
  }

  return heuristic;
}

// Manifest hashes that matched no collected commit — typo, rebase, or a
// --since window that excludes them. Informational, never an error.
export function unmatchedManifestHashes(index: ManifestIndex): string[] {
  return [...index.ai.keys(), ...index.human, ...index.excluded].filter(
    (hash) => !index.matched.has(hash)
  );
}
