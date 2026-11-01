import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatTrail, traceCommits } from './trail.js';

let repoPath: string;
let claudeDir: string;
const SID = '3a083123-96c6-48b5-86fe-52c9dbe942f6';

function git(cmd: string) {
  execSync(cmd, {
    cwd: repoPath,
    env: { ...process.env, EVIDTRAIL_MODE: '', CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '' },
  });
}

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), 'evidtrail-trail-repo-'));
  claudeDir = mkdtempSync(join(tmpdir(), 'evidtrail-trail-claude-'));
  git('git init -q -b main');
  git('git config user.name test && git config user.email test@example.com');
});

afterEach(() => {
  rmSync(repoPath, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
});

describe('evidtrail trail', () => {
  it('follows a commit to a transcript that exists on this machine, without reading it', async () => {
    mkdirSync(join(claudeDir, 'projects', '-some-project'), { recursive: true });
    const transcript = join(claudeDir, 'projects', '-some-project', `${SID}.jsonl`);
    writeFileSync(transcript, 'not read by evidtrail\n');
    git(`git commit -q --allow-empty -m "feat: x" -m "AI-Mode: agent" -m "AI-Session: claude-code/${SID}"`);

    const [entry] = await traceCommits(repoPath, ['HEAD'], { CLAUDE_CONFIG_DIR: claudeDir });
    expect(entry.tags.mode).toBe('agent');
    expect(entry.tags.evidence).toBe('declared');
    expect(entry.session).toEqual({ agent: 'claude-code', id: SID });
    expect(entry.transcript).toBe(transcript);
    expect(formatTrail(entry)).toContain(`transcript  ${transcript}`);
  });

  it('says where the trail ends when the transcript is elsewhere', async () => {
    git(`git commit -q --allow-empty -m "feat: x" -m "AI-Mode: agent" -m "AI-Session: claude-code/${SID}"`);
    const [entry] = await traceCommits(repoPath, ['HEAD'], { CLAUDE_CONFIG_DIR: claudeDir });
    expect(entry.transcript).toBeNull();
    expect(formatTrail(entry)).toContain('not on this machine');
  });

  it('does not search the disk for an agent whose store it does not know', async () => {
    git('git commit -q --allow-empty -m "feat: x" -m "AI-Mode: agent" -m "AI-Session: codex/run-42"');
    const [entry] = await traceCommits(repoPath, ['HEAD'], { CLAUDE_CONFIG_DIR: claudeDir });
    expect(entry.transcript).toBeNull();
    expect(formatTrail(entry)).toContain('does not know where codex stores sessions');
  });

  it('labels a silent commit as no evidence, not as human', async () => {
    git('git commit -q --allow-empty -m "fix: silent"');
    const [entry] = await traceCommits(repoPath, ['HEAD'], { CLAUDE_CONFIG_DIR: claudeDir });
    expect(entry.tags.evidence).toBe('none');
    expect(formatTrail(entry)).toContain('not evidence of a human');
    expect(formatTrail(entry)).toContain('session     none recorded');
  });

  it('agrees with collect on a commit the manifest overrides', async () => {
    // trail and the report must describe the same commit the same way. A
    // trail that ignored the manifest would call a commit AI that the
    // report calls automation, with nothing to say which one is right.
    git('git commit -q --allow-empty -m "chore: release" -m "Co-authored-by: Claude <noreply@anthropic.com>"');
    const hash = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
    writeFileSync(
      join(repoPath, 'evidtrail-attribution.json'),
      JSON.stringify({ version: '1', excluded_commits: [{ hash, reason: 'release commit' }] })
    );
    const [entry] = await traceCommits(repoPath, [hash], { CLAUDE_CONFIG_DIR: claudeDir });
    expect(entry.tags.automated).toBe(true);
    expect(formatTrail(entry)).toContain('provenance  automated');
  });
});
