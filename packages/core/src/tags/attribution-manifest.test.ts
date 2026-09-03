import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AttributionManifest,
  applyManifest,
  indexManifest,
  loadAttributionManifest,
  unmatchedManifestHashes,
} from './attribution-manifest.js';
import { AITagResult, tagFromAxes } from './ai-tags.js';

const HASH_AI = 'a'.repeat(40);
const HASH_HUMAN = 'b'.repeat(40);
const HASH_EXCLUDED = 'c'.repeat(40);
const HASH_ABSENT = 'd'.repeat(40);

function makeIndex() {
  return indexManifest(
    AttributionManifest.parse({
      version: '1.0',
      ai_assisted_commits: [{ hash: HASH_AI }],
      human_authored_commits: [{ hash: HASH_HUMAN }],
      excluded_commits: [{ hash: HASH_EXCLUDED, reason: 'Automated' }],
    })
  );
}

// Built through tagFromAxes so the fixtures cannot encode a state the
// tagger would never produce — `attribution` is a projection, not a value
// a test gets to choose independently of the axes.
const unknownTag: AITagResult = tagFromAxes(
  { mode: 'unknown', evidence: 'none', automated: false },
  'none',
  []
);
const aiTag: AITagResult = tagFromAxes(
  { mode: 'unknown', evidence: 'inferred', automated: false },
  'explicit',
  ['trailer:^AI:\\s*true$']
);

describe('applyManifest precedence', () => {
  it('tags manifest ai_assisted commits as explicit ai with source manifest', () => {
    const result = applyManifest(unknownTag, HASH_AI, makeIndex());
    expect(result.attribution).toBe('ai');
    expect(result.attribution).toBe('ai');
    expect(result.level).toBe('explicit');
    expect(result.sources).toContain('manifest');
  });

  it('merges heuristic sources when manifest confirms an already-detected ai commit', () => {
    const result = applyManifest(aiTag, HASH_AI, makeIndex());
    expect(result.attribution).toBe('ai');
    expect(result.sources).toEqual(['trailer:^AI:\\s*true$', 'manifest']);
  });

  it('tags manifest human_authored commits as human when heuristics found nothing', () => {
    const result = applyManifest(unknownTag, HASH_HUMAN, makeIndex());
    expect(result.attribution).toBe('human');
    expect(result.attribution).not.toBe('ai');
    expect(result.sources).toContain('manifest');
  });

  it('keeps ai when a human declaration conflicts with in-commit AI evidence, and warns', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const index = indexManifest(
      AttributionManifest.parse({
        version: '1.0',
        human_authored_commits: [{ hash: HASH_AI }],
      })
    );
    const result = applyManifest(aiTag, HASH_AI, index, logger);
    expect(result.attribution).toBe('ai');
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('excluded overrides heuristics and declares automation', () => {
    const result = applyManifest(aiTag, HASH_EXCLUDED, makeIndex());
    expect(result.attribution).toBe('automated');
    expect(result.attribution).not.toBe('ai');
    expect(result.mode).toBe('none');
    expect(result.evidence).toBe('declared');
    expect(result.sources).toContain('manifest:excluded');
  });

  it('leaves commits absent from the manifest untouched', () => {
    const result = applyManifest(unknownTag, HASH_ABSENT, makeIndex());
    expect(result).toEqual(unknownTag);
  });

  it('applies a manifest-level mode to ai entries as declared evidence', () => {
    const index = indexManifest(
      AttributionManifest.parse({
        version: '1.0',
        mode: 'agent',
        ai_assisted_commits: [{ hash: HASH_AI }],
      })
    );
    const result = applyManifest(unknownTag, HASH_AI, index);
    expect(result.mode).toBe('agent');
    expect(result.evidence).toBe('declared');
  });

  it('lets an entry-level mode override the manifest-level default', () => {
    const index = indexManifest(
      AttributionManifest.parse({
        version: '1.0',
        mode: 'agent',
        ai_assisted_commits: [{ hash: HASH_AI, mode: 'autocomplete' }],
      })
    );
    expect(applyManifest(unknownTag, HASH_AI, index).mode).toBe('autocomplete');
  });

  it('keeps the heuristic inferred mode when the manifest declares none', () => {
    const inferredTag: AITagResult = { ...aiTag, mode: 'agent', evidence: 'inferred' };
    const result = applyManifest(inferredTag, HASH_AI, makeIndex());
    expect(result.mode).toBe('agent');
    expect(result.evidence).toBe('inferred');
  });

  it('declares mode none for human_authored commits', () => {
    const result = applyManifest(unknownTag, HASH_HUMAN, makeIndex());
    expect(result.mode).toBe('none');
    expect(result.evidence).toBe('declared');
  });

  it('reports manifest hashes that matched no collected commit', () => {
    const index = makeIndex();
    applyManifest(unknownTag, HASH_AI, index);
    expect(unmatchedManifestHashes(index).sort()).toEqual([HASH_HUMAN, HASH_EXCLUDED].sort());
  });
});

describe('loadAttributionManifest', () => {
  it('returns null when the manifest is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidtrail-manifest-test-'));
    try {
      expect(await loadAttributionManifest(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns and returns null on an invalid manifest instead of throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidtrail-manifest-test-'));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    try {
      writeFileSync(join(dir, 'evidtrail-attribution.json'), '{ not json');
      expect(await loadAttributionManifest(dir, logger)).toBeNull();
      expect(logger.warn).toHaveBeenCalledOnce();

      writeFileSync(join(dir, 'evidtrail-attribution.json'), '{"ai_assisted_commits": "nope"}');
      expect(await loadAttributionManifest(dir, logger)).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reads the pre-rename aida-attribution.json, and says so', async () => {
    // A manifest is retroactive evidence; losing it on upgrade would turn
    // declared commits back into unknown without anyone noticing.
    const dir = mkdtempSync(join(tmpdir(), 'evidtrail-manifest-test-'));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    try {
      writeFileSync(
        join(dir, 'aida-attribution.json'),
        JSON.stringify({ version: '1.0', ai_assisted_commits: [{ hash: HASH_AI }] })
      );
      const manifest = await loadAttributionManifest(dir, logger);
      expect(manifest?.ai_assisted_commits).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0][0]).toContain('evidtrail-attribution.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses the documented format, defaulting absent lists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidtrail-manifest-test-'));
    try {
      writeFileSync(
        join(dir, 'evidtrail-attribution.json'),
        JSON.stringify({
          version: '1.0',
          tool: 'windsurf',
          model: 'claude-opus',
          note: 'documentation field',
          ai_assisted_commits: [{ hash: HASH_AI, message: 'feat: x' }],
        })
      );
      const manifest = await loadAttributionManifest(dir);
      expect(manifest?.ai_assisted_commits).toHaveLength(1);
      expect(manifest?.human_authored_commits).toEqual([]);
      expect(manifest?.excluded_commits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
