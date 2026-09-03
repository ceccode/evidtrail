# @evidtrail/core

Core Git collection, attribution, and versioned schemas for evidtrail metrics.

## Features

- Git commit collection with diff statistics
- AI-assisted commit detection using configurable heuristics
- Commit stream normalization and schema validation
- File system utilities for JSON I/O

## Usage

```typescript
import { collectCommits, createLogger } from '@evidtrail/core';

const commitStream = await collectCommits({
  repoPath: '/path/to/repo',
  since: '90d',
  aiPatterns: ['custom-ai-pattern'],
  logger: createLogger(true),
});
```

## AI Detection Patterns

Default patterns include:

- `\b(ai|copilot|cursor|windsurf|codeium)\b` - Common AI tool mentions
- `\[ai\]` - AI tags in commit messages
- Trailer patterns for `AI: true`, `X-AI: true`, and bot co-authors
