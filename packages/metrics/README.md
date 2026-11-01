# @evidtrail/metrics

Deterministic metric calculation for versioned evidtrail repository snapshots: provenance first, change signals as an appendix. Since 2.0 (metrics schema v4) there are no AI-vs-human cohort comparisons.

## What it calculates

- **Evidence coverage and autonomy** — declared, inferred, and missing provenance, autonomy counts, and how many AI commits link to an agent session. `defaultMode` is recorded, never applied: commits with no evidence stay `unknown`.
- **Repository change signals** — fixed-horizon rapid retouch at 7, 30, and 90 days, over all authored commits. Files without a complete observation window stay visible as `tooRecent`; rapid retouch is a file-level churn signal, not proof of a defect, wasted work, or causality.
- **Trend** — repository change signals over monthly or quarterly periods. Every period uses the same observation window; immature periods are reported but excluded from comparisons.
- **Line survival** — optional `git blame` input reports attribution for lines alive in the sampled tree. The surviving-line share is exact for that input; the derived survival rate is explicitly approximate because deleted lines are unavailable to blame.
- **Outcome correlation** — git-visible reverts and hotfix-pattern commits, expressed against each attribution group's share of authored commits. The results are descriptive, not causal, and do not include incidents or external security findings.
- **PR acceptance** — optional forge PR input reports merged versus closed-unmerged PRs, including attribution and autonomy breakdowns. It is absent when no PR stream is supplied, never silently zero.

For why evidtrail does not calculate Merge Ratio from Git history, see [Why there is no Merge Ratio](../../README.md#why-there-is-no-merge-ratio) in the repository README.

## Usage

```typescript
import { calculateMetrics } from '@evidtrail/metrics';

const metrics = calculateMetrics(commitStream);
const retouch30 = metrics.repo.persistence.rapidRetouch.find((r) => r.windowDays === 30);
console.log(`30-day rapid retouch: ${retouch30?.rate ?? 'unavailable'}`);
console.log(`Evidence coverage: ${metrics.attribution.coverage}`);
```

Pass `blameStream` from `evidtrail blame` or `prStream` from `evidtrail fetch-prs` to calculate the corresponding optional metrics. See the root [README](../../README.md) for the metric contracts, caveats, and CLI workflow.
