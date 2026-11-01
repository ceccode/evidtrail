import { describe, it, expect } from 'vitest';
import { sessionRef } from './session.js';

describe('sessionRef', () => {
  it('reads agent and id from the trailer', () => {
    expect(
      sessionRef('feat: x\n\nAI-Mode: agent\nAI-Session: claude-code/3a083123-96c6-48b5-86fe-52c9dbe942f6')
    ).toEqual({ agent: 'claude-code', id: '3a083123-96c6-48b5-86fe-52c9dbe942f6' });
  });

  it('is absent on a commit that records no session', () => {
    expect(sessionRef('feat: x\n\nAI-Mode: agent')).toBeNull();
  });

  // `trail` turns the id into a file name inside the agent's session store.
  // A trailer is untrusted text from history, so anything that could climb
  // out of that directory must not parse as a session at all.
  it('refuses ids that could become a path', () => {
    expect(sessionRef('x\n\nAI-Session: claude-code/../../etc/passwd')).toBeNull();
    expect(sessionRef('x\n\nAI-Session: claude-code/..')).toBeNull();
    expect(sessionRef('x\n\nAI-Session: claude-code/a b')).toBeNull();
    expect(sessionRef('x\n\nAI-Session: ../x')).toBeNull();
  });

  it('only counts as a trailer at the start of a line', () => {
    expect(sessionRef('docs: the AI-Session: claude-code/abc trailer')).toBeNull();
  });
});
