import { Command } from 'commander';
import {
  readJSON,
  createLogger,
  METRICS_SCHEMA_VERSION,
  assertSchemaVersion,
  describeError,
} from '@evidtrail/core';
import { Metrics } from '@evidtrail/metrics';
import { join } from 'path';
import { promises as fs } from 'fs';
import { CLIConfig } from '../schema/config.js';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatDelta(value: number, suffix: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${suffix}`;
}

type Persistence = Metrics['repo']['persistence'];

function rapidRetouch(
  persistence: Persistence,
  days: number
): Persistence['rapidRetouch'][number] | null {
  return persistence.rapidRetouch.find((result) => result.windowDays === days) ?? null;
}

function formatRetouch(result: ReturnType<typeof rapidRetouch>): string {
  return result?.rate === null || !result
    ? '—'
    : `${(result.rate * 100).toFixed(1)}% (${result.retouched}/${result.eligible})`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function escapeMarkdownTableCell(value: string): string {
  // Commit subjects are untrusted input and this report is commonly posted
  // to GitHub. Neutralize table syntax, formatting, HTML and @mentions while
  // preserving a readable subject for the person repairing the evidence.
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/[&<|>`*_@[\]\\]/g, (character) => `&#${character.codePointAt(0)};`);
}

function generatePRMarkdownReport(metrics: Metrics): string {
  // The PR comment is read in three seconds, on every push, by someone who
  // did not ask for it. The old version spent 42% of its words on caveats
  // that were identical on every PR — which trains readers to skip them, so
  // the one time a caveat matters it goes unread. Exception-driven instead:
  // the normal state is one line, everything else is collapsed, and a
  // caveat appears in the open only when it applies to THIS change set.
  const a = metrics.attribution;
  const coveragePct = (a.coverage * 100).toFixed(0);
  const gaps = a.missingEvidence.commits;
  const total = metrics.repo.commitsAuthored;
  const sha = metrics.headSha.slice(0, 12) || 'empty repo';

  const modeOrder = ['agent', 'assisted', 'autocomplete', 'none'] as const;
  const modeSummary = modeOrder
    .filter((mode) => a.modes[mode] > 0)
    .map((mode) => `${mode === 'none' ? 'hand-written' : mode} ${a.modes[mode]}`)
    .join(' · ');
  const automatedNote =
    metrics.repo.commitsAutomated > 0
      ? ` (+${countLabel(metrics.repo.commitsAutomated, 'automated commit')})`
      : '';

  // One line that says everything the reader needs to decide whether to
  // expand. Green when every commit carries provenance; a warning otherwise.
  const verdict =
    a.unknown === 0
      ? `**evidtrail** ✅ ${countLabel(total, 'commit')}${automatedNote} — ${modeSummary || 'no authored commits'} — every commit in this change set carries provenance.`
      : `**evidtrail** ⚠️ ${countLabel(total, 'commit')}${automatedNote} — **${countLabel(a.unknown, 'commit')} without provenance** (${coveragePct}% coverage)${modeSummary ? ` — ${modeSummary}` : ''}.`;

  // The exception, in the open: which commits, and the one-line repair. A
  // repository-wide defaultMode never closes this gap, so it is named here
  // when configured: a reader could otherwise assume it covers these commits.
  const gapRows = gaps
    .map(
      (commit) =>
        `| \`${commit.hash.slice(0, 12)}\` | ${escapeMarkdownTableCell(commit.subject)} |`
    )
    .join('\n');
  const gapSection =
    gaps.length > 0
      ? `
| Commit | Subject |
|---|---|
${gapRows}
${a.missingEvidence.truncated ? `\n_Only the first ${gaps.length} shown; ${a.unknown - gaps.length} more without evidence._\n` : ''}
For agent-produced work, declare \`AI-Mode: agent\` — install the hook in your clone with \`evidtrail install-hooks\`, or add \`"prepare": "evidtrail install-hooks --if-git"\` to \`package.json\` so every clone gets it. The reviewer who runs \`git commit\` stays the author; that is separate from how the content was produced.${
          a.defaultMode !== null
            ? `\n\n> \`defaultMode: ${a.defaultMode}\` is configured, but a repository-wide prior is not evidence about an individual commit: these stay \`unknown\` and coverage stays ${coveragePct}%.`
            : ''
        }
`
      : '';

  // Everything a curious reader might want, and nobody needs on every push.
  const modeRows = [...modeOrder, 'unknown' as const]
    .filter((mode) => a.modes[mode] > 0)
    .map((mode) => `| ${mode === 'none' ? 'none (hand-written)' : mode} | ${a.modes[mode]} |`);
  if (metrics.repo.commitsAutomated > 0) {
    modeRows.push(`| _automated (not authored)_ | ${metrics.repo.commitsAutomated} |`);
  }
  const filesTouched =
    metrics.repo.persistence.filesConsidered + metrics.repo.persistence.filesExcluded;

  const details = `
<details>
<summary>Details — scope, provenance, limits</summary>

**Scope:** \`base..HEAD\` @ \`${sha}\` — ${countLabel(filesTouched, 'file')} touched. A change-set view, not repository history or deployed state; time-based signals (rapid retouch, trend) are omitted because a fresh PR has not had a comparable observation window.

**Evidence:** ${coveragePct}% coverage — declared ${a.evidence.declared} · inferred ${a.evidence.inferred} · none ${a.evidence.none}.${a.sessions && a.sessions.linked > 0 ? ` ${countLabel(a.sessions.linked, 'AI commit')} linked to an agent session; \`evidtrail trail <commit>\` follows one.` : ''}

| Autonomy level | Commits |
|---|---:|
${modeRows.join('\n')}

**Limits**
${metrics.caveats.map((caveat) => `- ${caveat}`).join('\n')}

</details>
`;

  return `${verdict}
${gapSection}${details}`;
}

function generateMarkdownReport(metrics: Metrics): string {
  if (metrics.scope === 'pr') return generatePRMarkdownReport(metrics);

  const a = metrics.attribution;
  const coveragePct = (a.coverage * 100).toFixed(1);
  const unknownPct = a.commitsTotal > 0 ? ((a.unknown / a.commitsTotal) * 100).toFixed(1) : '0.0';

  // The recent window is the actionable number, so it leads and it drives
  // the warning; all-time stays visible as context (#52).
  const recentLine = a.recent
    ? `\n**Last ${a.recent.windowDays} days: ${(a.recent.coverage * 100).toFixed(1)}%** (${a.recent.commitsTotal} commits) — the number you can move. All-time: ${coveragePct}%.\n`
    : '';
  const warnOnRecent = a.recent ? a.recent.belowThreshold : a.belowThreshold;

  const coverageWarning = warnOnRecent
    ? `\n> ⚠️ **Coverage is below ${(a.coverageThreshold * 100).toFixed(0)}%${a.recent ? ` in the last ${a.recent.windowDays} days` : ''}.** The table below and the breakdowns by attribution under Change Signals (outcomes, pull requests, line survival) describe only the commits that carry evidence. The repository-level rows do not need it. Install the commit hook (\`evidtrail install-hooks\`) so new commits declare how they were produced; older commits can be declared in \`evidtrail-attribution.json\`.\n`
    : '';

  const priorNote =
    a.defaultMode !== null && a.evidence.none > 0
      ? `\n\`defaultMode\` is \`${a.defaultMode}\`: the commit hook stamps it on new commits. It is not applied to the ${a.evidence.none} commit${a.evidence.none === 1 ? '' : 's'} above with no evidence, because a repository setting says nothing about how a past commit was produced.\n`
      : '';

  const ls = metrics.lineSurvival;
  const lineSection = ls
    ? `### Line Survival

Exact per-line attribution from \`git blame\` — of the code alive in the collected tree, which observed commit last wrote it. Unlike file-level metrics, one AI line no longer marks a whole file.${ls.truncated ? '\n\n> ⚠️ Capped sample (`--max-files`): an evenly spaced slice of the tree, not the whole tree.' : ''}

| Cohort | Lines alive | Share |
|---|---:|---:|
| ai | ${ls.byAttribution.ai} | ${(ls.aiShare * 100).toFixed(1)}% |
| human | ${ls.byAttribution.human} | ${ls.totalLines > 0 ? ((ls.byAttribution.human / ls.totalLines) * 100).toFixed(1) : '0.0'}% |
| automated | ${ls.byAttribution.automated} | ${ls.totalLines > 0 ? ((ls.byAttribution.automated / ls.totalLines) * 100).toFixed(1) : '0.0'}% |
| unknown | ${ls.byAttribution.unknown} | ${ls.totalLines > 0 ? ((ls.byAttribution.unknown / ls.totalLines) * 100).toFixed(1) : '0.0'}% |

By autonomy level: agent ${ls.byMode.agent} · assisted ${ls.byMode.assisted} · autocomplete ${ls.byMode.autocomplete} · none ${ls.byMode.none} · unknown ${ls.byMode.unknown}

${ls.filesBlamed} files blamed, ${ls.totalLines} lines${ls.filesSkipped > 0 ? `, ${ls.filesSkipped} skipped (binary/empty)` : ''}${ls.filesFailed > 0 ? `, **${ls.filesFailed} failed to blame** (their lines are missing from these figures)` : ''}${ls.filesExcluded > 0 ? `, ${ls.filesExcluded} excluded (generated)` : ''}${ls.linesOutsideWindow > 0 ? `, ${ls.linesOutsideWindow} lines from commits outside the collected window` : ''}.

Approximate survival of AI-introduced lines: **${(ls.approxSurvivalRate * 100).toFixed(1)}%** (${ls.byAttribution.ai} alive of ${ls.introducedByAI} added). Both figures cover only the ${ls.filesBlamed} files blamed above${ls.truncated ? ' — with a capped sample that is a slice of the tree, not a verdict on it' : ''}. Approximate because blame cannot see deleted lines, a line rewritten twice was added twice, and additions to files since deleted or renamed fall outside the count.

`
    : '';

  const oc = metrics.outcomeCorrelation;
  // A bare count is uninterpretable: in a repo that is 90% AI, 90% of
  // reverts being AI means nothing at all. Every row carries the cohort's
  // base rate and the ratio between them, so an excess is visible and a
  // non-excess can't be misread as one.
  function outcomeRows(rates: Metrics['outcomeCorrelation']['reverts']['rates']) {
    return (['ai', 'human', 'unknown'] as const)
      .map((cohort) => {
        const r = rates[cohort];
        if (r.share === null) return null;
        const ratio =
          r.ratio === null
            ? '—'
            : `**${r.ratio.toFixed(2)}×**${r.ratio >= 1.5 ? ' ⚠️' : r.ratio <= 0.67 ? ' ✅' : ''}`;
        return `| ${cohort} | ${r.count} | ${(r.share * 100).toFixed(1)}% | ${r.baseRate === null ? '—' : `${(r.baseRate * 100).toFixed(1)}%`} | ${ratio} |`;
      })
      .filter(Boolean);
  }

  const revertRows = oc.reverts.resolved > 0 ? outcomeRows(oc.reverts.rates) : [];
  const hotfixRows = oc.hotfixes.linked > 0 ? outcomeRows(oc.hotfixes.rates) : [];
  const outcomeSection =
    revertRows.length > 0 || hotfixRows.length > 0
      ? `### Outcome Correlation

Reverts and hotfix-pattern commits, linked back to the attribution of the commit(s) they respond to — scoped to what git itself can answer (no incidents, no SAST).

**Read the ratio, not the count.** A cohort's share of outcomes only means something against its share of authored commits: **1.00× is exactly what its size predicts**, above is more than its share predicts, below is fewer. Automated commits are excluded from both sides.
${
  revertRows.length > 0
    ? `
#### Reverted commits (${oc.reverts.resolved} of ${oc.reverts.total} reverts resolved to a target)

| Cohort of the reverted commit | Count | Share of reverts | Share of commits | Ratio |
|---|---:|---:|---:|---:|
${revertRows.join('\n')}
`
    : ''
}${
  hotfixRows.length > 0
    ? `
#### Hotfix antecedents (${oc.hotfixes.linked} of ${oc.hotfixes.total} hotfixes linked, ${oc.hotfixes.windowDays}d window)

| Cohort of the antecedent | Count | Share of hotfixes | Share of commits | Ratio |
|---|---:|---:|---:|---:|
${hotfixRows.join('\n')}
`
    : ''
}
`
      : '';

  const acc = metrics.prAcceptance;
  function accRow(label: string, stats: { total: number; merged: number; closed: number; acceptanceRate: number } | null) {
    if (!stats) return null;
    return `| ${label} | ${stats.total} | ${stats.merged} | ${stats.closed} | ${(stats.acceptanceRate * 100).toFixed(1)}% |`;
  }
  const prSection = acc
    ? `### PR Merge Outcome

Merged vs closed-unmerged in the ${acc.provider} API. This is an observable repository outcome, not proof of review quality, deployment, or business acceptance.${acc.truncated ? '\n\n> ⚠️ Partial data: the PR window or at least one commit list was capped.' : ''}

| Cohort | PRs | Merged | Closed unmerged | Acceptance |
|---|---:|---:|---:|---:|
${[
  accRow('**All PRs**', acc.overall),
  accRow('ai', acc.byAttribution.ai),
  accRow('human', acc.byAttribution.human),
  accRow('unknown', acc.byAttribution.unknown),
  accRow('mode: agent', acc.byMode.agent),
  accRow('mode: assisted', acc.byMode.assisted),
  accRow('mode: autocomplete', acc.byMode.autocomplete),
]
  .filter(Boolean)
  .join('\n')}

`
    : '';

  // The repository block opens Change Signals because it is the only view
  // there that needs no attribution evidence: valid at 0% coverage. It once
  // replaced a "Persistence" section that rendered the AI cohort's numbers
  // under a generic-looking heading — cohort data wearing a repo-level label.
  const rq = metrics.repo;
  const rqp = rq.persistence;

  // A bounded run observes nothing past its bound. Saying so next to the
  // table is what keeps "too recent" from reading as "never touched again"
  // when the reader knows the repository has moved on since.
  const observationNote = metrics.window.until
    ? `\nObservation ends at **${metrics.window.observationEnd ?? metrics.window.until}** (the \`--until\` bound): files first touched shortly before it are *too recent*, not untouched, and periods that end after it are immature below.\n`
    : '';

  // A windowed run measures a different population, not the same one over a
  // shorter span: a file's clock starts at its first touch INSIDE the
  // window, so long-lived files enter as if new. The same repository read
  // 68% over its full history and 90% over its last 90 days — both correct,
  // and only comparable with runs of the same window.
  const windowNote = metrics.window.since
    ? `\nWindow starts at **${metrics.window.since}** (\`--since\`): a file's first touch is its first touch inside the window, so files that predate it count from their first edit here, not from their creation. Rates from a windowed run compare with other runs of the same window, not with full history.\n`
    : '';

  // Change signals over time. The headline is
  // the direction of travel, not the snapshot — and the direction is only
  // readable between periods that have had the same amount of time to be
  // reworked, hence the maturity marker below.
  const tr = metrics.trend;
  const lc = tr.latestComparison;
  // Size comparability (#102) sits next to maturity: a mature pair can still
  // be a poor pair. Insufficient → the delta is withheld and the reason
  // stated; weak → the delta is shown and labelled. The pair is never swapped
  // for a friendlier one.
  const cmp = lc?.comparability;
  const trendHeadline = lc
    ? cmp?.status === 'insufficient'
      ? `**${lc.from} → ${lc.to}: comparison withheld** — ${cmp.reasons.join('; ')}. Both periods are mature, but a handful of files cannot carry a percentage; the rows below show what each period contains.`
      : lc.rapidRetouchRate
        ? `**${lc.from} → ${lc.to}:** rapid retouch within ${tr.observationDays}d ${(lc.rapidRetouchRate.from * 100).toFixed(1)}% → **${(lc.rapidRetouchRate.to * 100).toFixed(1)}%** (${formatDelta(round1(lc.rapidRetouchRate.delta * 100), ' pt')}).${
            cmp?.status === 'weak'
              ? ` *Weak comparison* — the periods differ in size: ${cmp.reasons.join(', ')}. A change of pace is being measured along with any change in the code.`
              : ''
          }`
        : `**${lc.from} → ${lc.to}:** not enough eligible files for a ${tr.observationDays}-day comparison.`
    : `**No comparison yet** — fewer than two periods have been over for the full ${tr.observationDays}-day observation window. A trend needs two points that have had the same amount of time.`;

  const immature = tr.periods.filter((p) => !p.mature).length;
  const trendRows = tr.periods.map((p) => {
    const persistence = p.persistence;
    return `| ${p.label}${p.mature ? '' : ' *(immature)*'} | ${p.commitsAuthored} | ${persistence ? formatRetouch(rapidRetouch(persistence, tr.observationDays)) : '—'} | ${p.coverage === null ? '—' : `${(p.coverage * 100).toFixed(0)}%`} |`;
  });

  const trendSection =
    tr.periods.length > 0
      ? `
#### Trend (${tr.granularity}ly, ${tr.observationDays}-day observation window)

${trendHeadline}

Every period is measured through the same ${tr.observationDays}-day window, so no period gets credit for time the others have not had.

| Period | Commits | Retouched ≤${tr.observationDays}d | Coverage |
|---|---:|---:|---:|
${trendRows.join('\n')}
${immature > 0 ? `\n*(immature)* — Too recent to judge: the period has not been over for the full ${tr.observationDays}-day window, so its files have had less time to be reworked than every period above. Shown for completeness, excluded from the comparison — otherwise every report would find quality declining.\n` : ''}`
      : '';
  const codeQualitySection = `### Repository

How files change again, as a property of the **repo** — measured over all ${rq.commitsAuthored} authored commits (${rq.commitsAutomated} automated excluded). No attribution evidence required: these numbers do not move with coverage.

- Files measured: ${rqp.filesConsidered} (${rqp.filesExcluded} excluded: migrations/generated)
${windowNote}
**Rapid retouch** means a subsequent commit touched the same file within the stated horizon. It is a churn signal, not proof of a defect or “rework”. A file is eligible once it is retouched in time or has been observed event-free for the full horizon; otherwise it is too recent.
${observationNote}
| Horizon | Retouched | Eligible | Too recent | Rate |
|---:|---:|---:|---:|---:|
${rqp.rapidRetouch.map((result) => `| ${result.windowDays}d | ${result.retouched} | ${result.eligible} | ${result.tooRecent} | ${result.rate === null ? '—' : `${(result.rate * 100).toFixed(1)}%`} |`).join('\n')}
${trendSection}
`;

  // Provenance leads. It is the part of this report git can actually
  // answer: what each commit states about how it was produced. Change
  // signals follow, with their limit stated first: mistakes an agent finds
  // and fixes inside its session never reach git. Before this ordering the
  // report opened on a retouch rate and its trend, and readers took the
  // first number they saw as the verdict on AI-written code.
  return `# evidtrail Report

**Repo:** ${metrics.repoPath}
**Default branch:** ${metrics.defaultBranch}
**Scope:** ${metrics.scope} @ ${metrics.headSha.slice(0, 12) || 'empty repo'}
**Window:** ${metrics.window.since || 'beginning'} → ${metrics.window.until || 'now'}
**Generated:** ${metrics.generatedAt}

## Provenance

**${coveragePct}% of commits carry provenance evidence** — declared ${a.evidence.declared} · inferred ${a.evidence.inferred} · none ${a.evidence.none} (${unknownPct}%). *Declared* means the commit states it, in a trailer or the attribution manifest. *Inferred* means evidtrail concluded it from a co-author or a tool name. A commit with no evidence is not evidence of a human.
${
  a.aiModeUnknown
    ? `\nOf the ${a.ai} AI commits, **${a.aiModeUnknown} carry a signal of AI involvement but no autonomy level**: coverage counts them, the table below counts them as \`unknown\`. Full coverage is not full knowledge of how the code was produced.\n`
    : ''
}${
  a.sessions && a.sessions.linked > 0
    ? `\n**${a.sessions.linked} of the ${a.ai} AI commits link to an agent session** (${a.sessions.distinct} distinct). Git holds what each session committed; the session holds what was tried and fixed before that. \`evidtrail trail <commit>\` follows a commit to its transcript when the transcript is on this machine. evidtrail reads nothing from the sessions.\n`
    : ''
}${recentLine}${coverageWarning}
| Autonomy level | Commits |
|---|---:|
| agent | ${a.modes.agent} |
| assisted | ${a.modes.assisted} |
| autocomplete | ${a.modes.autocomplete} |
| none (hand-written) | ${a.modes.none} |
| unknown | ${a.modes.unknown} |
| _automated (not authored)_ | ${a.automated} |

*Three-state view:* ai ${a.ai} · human ${a.human} · automated ${a.automated} · unknown ${a.unknown} — a projection of the table above, kept for a one-word headline.
${priorNote}
## Change Signals

What git records after a commit: files touched again, lines still alive, reverts, hotfixes, merged pull requests. These are churn signals, not a quality score. Mistakes an agent makes and fixes inside its session never reach git, so they leave no trace here, and a rate that moves says the work changed, not why. Read them as places to look closer.

${codeQualitySection}${lineSection}${outcomeSection}${prSection}
## Caveats
${metrics.caveats.map((caveat) => `- ${caveat}`).join('\n')}
`;
}

export function createReportCommand(): Command {
  return new Command('report')
    .description('Generate report from metrics.json')
    .option('--out-dir <path>', 'Output directory', './evidtrail-output')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const config = CLIConfig.parse(options);
      const logger = createLogger(config.verbose);

      try {
        logger.info('Generating report...');

        const inputPath = join(config.outDir, 'metrics.json');
        const raw = await readJSON<unknown>(inputPath);
        assertSchemaVersion(
          raw,
          METRICS_SCHEMA_VERSION,
          'metrics.json',
          "Rerun 'evidtrail analyze' with this version of evidtrail."
        );
        const metrics = Metrics.parse(raw);

        const markdown = generateMarkdownReport(metrics);
        const mdPath = join(config.outDir, 'report.md');
        await fs.writeFile(mdPath, markdown, 'utf-8');
        logger.info(`Markdown report written to: ${mdPath}`);

        logger.info('Report generation completed');
      } catch (error) {
        logger.error(
          `Report generation failed: ${describeError(error)}`
        );
        process.exit(1);
      }
    });
}
