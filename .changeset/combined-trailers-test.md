---
---

Test only, no release: the commit hook's three trailers (`AI-Mode`, `Assisted-by`, `AI-Session`) come out as one trailer block that `git interpret-trailers` parses. They were written by two changes that never saw each other. #109's description says this test exists; it was left out of that merge by mistake.
