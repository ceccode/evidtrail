---
'@evidtrail/cli': patch
'@evidtrail/core': patch
'@evidtrail/metrics': patch
---
The descriptions say what the tool does since 1.3

1.3 made provenance the product: `Assisted-by`, `evidtrail verify`, `AI-Session` and a report that opens with Provenance. The npm descriptions, package READMEs and keywords still described "an auditable ledger of AI provenance and change signals", with retouch first and a roadmap towards cost accounting. A reader deciding whether to install would have expected a code-quality tool, which the 1.3 report itself says git cannot be.

Now every surface uses one sentence: AI provenance for git, declared at commit time, checked in CI, traceable to the agent session. Change signals are described as an appendix that measures churn, not quality. No behaviour changes.
