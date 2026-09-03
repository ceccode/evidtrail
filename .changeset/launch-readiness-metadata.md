---
'@aida-dev/cli': patch
'@aida-dev/core': patch
'@aida-dev/metrics': patch
---

Launch readiness: one positioning sentence across every surface, and the metadata search engines, social cards and LLMs actually read

A pre-launch scan found the project describing itself three different ways: the GitHub description promised to "measure the real impact of AI coding agents" — the exact claim the README says AIDA does not make — the landing's Twitter card still carried the pre-1.0 tagline, and npm called the CLI a "CLI for the AIDA auditable evidence ledger", which nobody searches for. This aligns all of them on one sentence: *An auditable ledger of AI provenance and change signals for your git repositories — honest about what git can and cannot prove.*

- **npm**: descriptions rewritten around that sentence; keywords with real search intent (`ai-attribution`, `provenance`, `claude-code`, `github-copilot`, `engineering-metrics`, `github-actions`); `homepage` points to the website; repository URL case-corrected.
- **Landing**: canonical URL (the old `og:url` had the wrong case and no trailing slash), `og:image`/`twitter:image` (the `summary_large_image` card had no image and rendered blank), aligned Twitter description, favicon, JSON-LD `SoftwareApplication` + `FAQPage`, and a new "What AIDA is — and is not" section written as question → answer. Bounded definitions and explicit limits are the passages LLM answers quote verbatim; AIDA's honesty is its GEO asset.
- **Crawl files**: `robots.txt`, `sitemap.xml`, `llms.txt`.
- **Repository**: `CONTRIBUTING.md` (the working agreements in second person), a single issue template — *Misleading number*, the bug report this project most wants — a PR template with the dogfood table and the never-stack rule, and a composite `action.yml` so a workflow becomes `uses: ceccode/AIDA-Metrics@v1` instead of 99 copied lines. The action runs `aida doctor` first: a shallow checkout is refused before it can produce a confidently wrong report.
- **README fold**: the positioning sentence first, and "What AIDA is not" promoted to its own heading — the most quotable thing the project has.

Nothing here changes what the tool computes.
