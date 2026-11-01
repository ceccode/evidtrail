import { describe, it, expect } from 'vitest';
import { EvidtrailConfig, assertNoRetiredConfigKeys } from './evidtrail-config.js';

describe('assertNoRetiredConfigKeys', () => {
  // A config still carrying the retired prior must not parse cleanly and
  // quietly stop applying: a setting the repository chose would vanish on
  // the day it upgrades, with no warning at all.
  it('refuses a config that still uses defaultAttribution', () => {
    expect(() => assertNoRetiredConfigKeys({ defaultAttribution: 'ai' })).toThrow(/defaultMode/);
  });

  it('names the replacement value for each retired one', () => {
    expect(() => assertNoRetiredConfigKeys({ defaultAttribution: 'human' })).toThrow(
      /"defaultMode": "none"/
    );
    expect(() => assertNoRetiredConfigKeys({ defaultAttribution: 'ai' })).toThrow(
      /"defaultMode": "assisted"/
    );
  });

  it('accepts a migrated config, and anything without the key', () => {
    expect(() => assertNoRetiredConfigKeys({ defaultMode: 'agent' })).not.toThrow();
    expect(() => assertNoRetiredConfigKeys({})).not.toThrow();
    expect(() => assertNoRetiredConfigKeys(null)).not.toThrow();
  });

  it('parses a migrated config into the expected shape', () => {
    const config = EvidtrailConfig.parse({ defaultMode: 'agent' });
    expect(config.defaultMode).toBe('agent');
    expect(config).not.toHaveProperty('defaultAttribution');
  });
});
