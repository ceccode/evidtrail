import { FileCategory } from './schema/metrics.js';

// File categorization (#36): decides which files the change signals leave
// out by default (migrations, generated). Order matters: first match wins.
export function categorizeFile(path: string): FileCategory {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? lower;

  // Generated artifacts (lockfiles, changelogs, snapshots, build output)
  if (
    /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|composer\.lock|cargo\.lock|gemfile\.lock|poetry\.lock|changelog(\.[a-z]+)?)$/.test(
      base
    ) ||
    /\.(snap|min\.js|min\.css)$/.test(base) ||
    /(^|\/)(dist|build|out|coverage|\.next|node_modules)\//.test(lower)
  ) {
    return 'generated';
  }

  if (
    /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|cypress)\//.test(lower) ||
    /\.(test|spec)\.[a-z]+$/.test(base)
  ) {
    return 'tests';
  }

  if (/(^|\/)migrations?\//.test(lower)) {
    return 'migrations';
  }

  if (/\.(md|mdx|rst|adoc|txt)$/.test(base) || /(^|\/)docs?\//.test(lower)) {
    return 'docs';
  }

  if (
    base.startsWith('.') ||
    /\.(json|ya?ml|toml|ini|cfg|conf|env|properties)$/.test(base) ||
    /\.config\.[a-z]+$/.test(base) ||
    /(^|\/)(\.github|\.circleci|\.vscode|config)\//.test(lower) ||
    /^(dockerfile|makefile|tsconfig.*|eslint.*|prettier.*)/.test(base)
  ) {
    return 'config';
  }

  return 'source';
}
