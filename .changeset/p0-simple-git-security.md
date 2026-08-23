---
'@aida-dev/core': patch
---

Upgrade `simple-git` to the patched 3.36.0 release for its remote-command execution advisories. Reject option-shaped default-branch and PR base refs before they reach Git, so CLI or CI input remains data rather than command options.
