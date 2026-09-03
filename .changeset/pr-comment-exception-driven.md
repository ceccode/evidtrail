---
'@aida-dev/cli': minor
---

PR comment is now exception-driven: one line when everything is fine, the problem in the open when it is not

The PR comment is read in three seconds, on every push, by someone who did not ask for it. The previous version was 38 lines and 245 words — 42% of them caveats repeated identically on every PR. A caveat that appears every time trains readers to skip it, so the one time it matters it goes unread. Verbosity was working against honesty.

Now:

- **Normal state is one line.** `**AIDA** ✅ 3 commits — agent 3 — every commit in this change set carries provenance.` Nineteen words in the open on this repo's own PRs, down from 245.
- **The exception is in the open, with the repair.** When commits lack provenance, the verdict line turns to ⚠️ with the count and coverage, followed by the commits themselves and the one-line fix (`aida install-hooks`, or the `prepare` recipe). The `defaultMode` reminder appears only when a prior is actually configured — it is a warning about a specific misunderstanding, not boilerplate.
- **Everything else folds into `<details>`** — scope and SHA, evidence breakdown, the autonomy table (zero rows omitted), and the interpretation limits. Present for whoever wants them, invisible to everyone else.
- **Dropped as noise for this surface:** the absolute repo path (meaningless in CI, you are already in the repo), the generation timestamp (GitHub shows the edit time), and autonomy rows with zero commits.

The full report (`aida report` on default-branch scope) is unchanged; this only touches the PR-scoped template. The comment is still upserted in place via the `<!-- aida-metrics-report -->` marker, so a PR never accumulates stale copies.
