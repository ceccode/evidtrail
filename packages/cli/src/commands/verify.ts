import { Command } from 'commander';
import {
  readJSON,
  createLogger,
  COMMIT_STREAM_SCHEMA_VERSION,
  assertSchemaVersion,
  describeError,
  CommitStream,
} from '@evidtrail/core';
import { join } from 'path';

// `evidtrail verify` — the provenance check a CI job can fail on, in the
// spirit of the DCO check for Signed-off-by. It reads the stream `collect`
// wrote, so the range is whatever `collect --pr` or `--diff-base` resolved.
//
// What passes is a statement about the commit itself: an AI-Mode or
// Assisted-by trailer, or the attribution manifest. `AI-Mode: none` passes
// too: the check asks that provenance be stated, not that it be AI. A
// `defaultMode` prior never passes, because collect does not apply it and
// a repository setting is not a statement about one commit.

export type Requirement = 'declared' | 'evidence';

export interface VerifyFailure {
  hash: string;
  subject: string;
  evidence: 'declared' | 'inferred' | 'none';
}

export interface VerifyResult {
  checked: number;
  automated: number;
  failures: VerifyFailure[];
}

export function verifyStream(stream: CommitStream, require: Requirement): VerifyResult {
  let checked = 0;
  let automated = 0;
  const failures: VerifyFailure[] = [];
  for (const commit of stream.commits) {
    // Merge commits and known bots have known provenance and no author to
    // ask. Failing a PR over a merge commit would teach people to ignore
    // the check.
    if (commit.tags.automated) {
      automated++;
      continue;
    }
    checked++;
    const ok =
      require === 'declared'
        ? commit.tags.evidence === 'declared'
        : commit.tags.evidence !== 'none';
    if (!ok) {
      failures.push({
        hash: commit.hash,
        subject: commit.message.split('\n')[0] ?? '',
        evidence: commit.tags.evidence,
      });
    }
  }
  return { checked, automated, failures };
}

export function formatVerifyResult(result: VerifyResult, require: Requirement, scope: string): string {
  const has = require === 'declared' ? 'a provenance declaration' : 'a provenance signal';
  const lacks = require === 'declared' ? 'a provenance declaration' : 'any provenance signal';
  const lines: string[] = [];
  if (result.failures.length === 0) {
    lines.push(
      `evidtrail verify: ${result.checked} commit(s) checked, all carry ${has}` +
        (result.automated > 0 ? ` (${result.automated} automated skipped)` : '') +
        '.'
    );
  } else {
    lines.push(
      `evidtrail verify: ${result.failures.length} of ${result.checked} commit(s) lack ${lacks}:`
    );
    for (const failure of result.failures) {
      lines.push(`  ${failure.hash.slice(0, 12)}  ${failure.subject}  (evidence: ${failure.evidence})`);
    }
    lines.push(
      '',
      require === 'declared'
        ? 'Declare each commit with an `AI-Mode:` trailer (`evidtrail install-hooks` writes it), an `Assisted-by:` trailer, or an entry in evidtrail-attribution.json. `AI-Mode: none` is a valid declaration for hand-written work.'
        : 'Each of these commits has no AI-Mode, Assisted-by, co-author or tool signal at all.'
    );
  }
  if (scope !== 'pr') {
    lines.push(
      '',
      `Note: this stream has scope "${scope}", not a pull request. Every commit in it was checked, including history from before the policy existed.`
    );
  }
  return lines.join('\n');
}

export function createVerifyCommand(): Command {
  return new Command('verify')
    .description('Fail when collected commits do not state their provenance (a CI check)')
    .option('--out-dir <path>', 'Directory holding commit-stream.json', './evidtrail-output')
    .option(
      '--require <level>',
      'declared: every commit carries AI-Mode, Assisted-by or a manifest entry; evidence: any signal at all',
      'declared'
    )
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(Boolean(options.verbose));
      // 1 = commits lack provenance, 2 = the check itself could not run. A
      // CI job must be able to tell "policy failed" from "tool broke".
      let failed = false;
      try {
        const require = options.require as string;
        if (require !== 'declared' && require !== 'evidence') {
          throw new Error(`Invalid --require "${require}": expected declared or evidence`);
        }
        const raw = await readJSON<unknown>(join(options.outDir, 'commit-stream.json'));
        assertSchemaVersion(
          raw,
          COMMIT_STREAM_SCHEMA_VERSION,
          'commit-stream.json',
          "Rerun 'evidtrail collect' with this version of evidtrail."
        );
        const stream = CommitStream.parse(raw);
        const result = verifyStream(stream, require);
        console.log(formatVerifyResult(result, require, stream.scope));
        failed = result.failures.length > 0;
      } catch (error) {
        logger.error(`Verify failed: ${describeError(error)}`);
        process.exit(2);
      }
      if (failed) process.exit(1);
    });
}
