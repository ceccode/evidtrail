import { Command } from 'commander';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  createLogger,
  createProvenanceTagger,
  describeError,
  indexManifest,
  loadAttributionManifest,
  sessionRef,
  SessionRef,
  AITagResult,
} from '@evidtrail/core';
import { loadConfig } from '../config/load.js';

const execFileAsync = promisify(execFile);

// `evidtrail trail <commit>` — follow one commit back as far as the evidence
// goes. Git says what the commit states about how it was produced; an
// `AI-Session:` trailer says which agent session produced it; the session
// store on this machine may still hold that transcript. trail reports each
// step and stops where the trail ends. It never opens a transcript: whether
// to read or share one is the user's decision, not a side effect.

export interface TrailEntry {
  hash: string;
  subject: string;
  tags: AITagResult;
  session: SessionRef | null;
  transcript: string | null;
}

// Where an agent keeps its session transcripts. Only agents whose layout is
// known are listed; for anything else trail says it does not know, rather
// than searching the disk.
export async function findTranscript(
  session: SessionRef,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  if (session.agent !== 'claude-code') return null;
  const root = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  let projects: string[];
  try {
    projects = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const project of projects) {
    const candidate = join(root, project, `${session.id}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not in this project directory
    }
  }
  return null;
}

async function readCommit(
  repo: string,
  rev: string
): Promise<{
  hash: string;
  message: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
}> {
  // `--end-of-options` keeps a revision that starts with `-` from being
  // read as a flag.
  const { stdout } = await execFileAsync(
    'git',
    ['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B', '--end-of-options', rev],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 }
  );
  const [hash, parents, authorName, authorEmail, committerName, committerEmail, ...rest] =
    stdout.split('\0');
  return {
    hash,
    parents: parents.split(' ').filter(Boolean),
    authorName,
    authorEmail,
    committerName,
    committerEmail,
    message: rest.join('\0').replace(/\n+$/, ''),
  };
}

export async function traceCommits(
  repo: string,
  revs: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<TrailEntry[]> {
  const fileConfig = await loadConfig(repo);
  const manifest = await loadAttributionManifest(repo);
  // The same tagger `collect` uses, so trail and the report can never
  // disagree about the same commit.
  const tag = createProvenanceTagger({
    patterns: fileConfig.patterns || [],
    tools: fileConfig.tools || [],
    trailerDomains: fileConfig.trailerDomains || [],
    botBlocklist: fileConfig.botBlocklist || [],
    manifestIndex: manifest ? indexManifest(manifest) : null,
  });

  const entries: TrailEntry[] = [];
  for (const rev of revs) {
    const commit = await readCommit(repo, rev);
    const session = sessionRef(commit.message);
    entries.push({
      hash: commit.hash,
      subject: commit.message.split('\n')[0] ?? '',
      tags: tag(commit),
      session,
      transcript: session ? await findTranscript(session, env) : null,
    });
  }
  return entries;
}

export function formatTrail(entry: TrailEntry): string {
  const t = entry.tags;
  const level = t.automated ? 'automated' : t.mode;
  const lines = [
    `${entry.hash.slice(0, 12)}  ${entry.subject}`,
    `  provenance  ${level} · ${t.evidence}${t.sources.length > 0 ? ` (${t.sources.join(', ')})` : ''}`,
  ];
  if (t.evidence === 'none') {
    lines.push('              no evidence either way: this is not evidence of a human');
  }
  if (!entry.session) {
    lines.push('  session     none recorded');
  } else {
    lines.push(`  session     ${entry.session.agent}/${entry.session.id}`);
    if (entry.transcript) {
      lines.push(`  transcript  ${entry.transcript}`);
    } else if (entry.session.agent === 'claude-code') {
      lines.push('  transcript  not on this machine (sessions stay where the agent ran)');
    } else {
      lines.push(`  transcript  evidtrail does not know where ${entry.session.agent} stores sessions`);
    }
  }
  return lines.join('\n');
}

export function createTrailCommand(): Command {
  return new Command('trail')
    .description('Follow commits back to what they state and to the agent session that made them')
    .argument('[revs...]', 'Commits to follow (default: HEAD)')
    .option('--repo <path>', 'Repository path', process.cwd())
    .option('--json', 'Print JSON instead of text', false)
    .option('--verbose', 'Verbose logging', false)
    .action(async (revs: string[], options) => {
      const logger = createLogger(Boolean(options.verbose));
      try {
        const entries = await traceCommits(options.repo, revs.length > 0 ? revs : ['HEAD']);
        console.log(
          options.json
            ? JSON.stringify(entries, null, 2)
            : entries.map(formatTrail).join('\n\n')
        );
      } catch (error) {
        logger.error(`Trail failed: ${describeError(error)}`);
        process.exit(1);
      }
    });
}
