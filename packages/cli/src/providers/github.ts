import type { CIProvider, PRIdentifier } from './types.js';
import { readFileSync } from 'fs';

const MARKER = '<!-- evidtrail-report -->';
// Comments posted before the rename carry the old marker. They must still be
// found and replaced, or every PR open across the upgrade grows a second copy.
const LEGACY_MARKER = '<!-- aida-metrics-report -->';

function sanitizeErrorBody(text: string, maxLength = 200): string {
  // Strip potential tokens, auth headers, and URLs with credentials
  let sanitized = text
    .replace(/ghp_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/gho_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/token\s+[A-Za-z0-9._-]+/gi, 'token [REDACTED]');
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '...(truncated)';
  }
  return sanitized;
}

interface GitHubEvent {
  pull_request?: {
    number: number;
  };
  number?: number;
}

export class GitHubProvider implements CIProvider {
  name = 'github';

  private get token(): string {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN is required for GitHub PR comments. Pass it via env.');
    }
    return token;
  }

  private get repo(): string {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) {
      throw new Error('GITHUB_REPOSITORY env var not found. Are you running in GitHub Actions?');
    }
    return repo;
  }

  private get apiUrl(): string {
    return process.env.GITHUB_API_URL || 'https://api.github.com';
  }

  getPRIdentifier(): PRIdentifier | null {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) return null;

    try {
      const event: GitHubEvent = JSON.parse(readFileSync(eventPath, 'utf-8'));
      const prNumber = event.pull_request?.number || event.number;
      if (!prNumber) return null;

      return {
        provider: 'github',
        prNumber: String(prNumber),
        repo: this.repo,
      };
    } catch {
      return null;
    }
  }

  async postComment(content: string, marker: string = MARKER): Promise<void> {
    const pr = this.getPRIdentifier();
    if (!pr) {
      throw new Error('Could not determine PR number. Is this running on a pull_request event?');
    }

    const markedContent = `${marker}\n${content}`;

    // Try to find and update existing comment
    const existingId = await this.findExistingComment(pr, marker);

    if (existingId) {
      await this.updateComment(existingId, markedContent);
    } else {
      await this.createComment(pr, markedContent);
    }
  }

  private async findExistingComment(pr: PRIdentifier, marker: string): Promise<number | null> {
    const url = `${this.apiUrl}/repos/${pr.repo}/issues/${pr.prNumber}/comments?per_page=100`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) return null;

    const comments = (await response.json()) as Array<{ id: number; body: string }>;
    const existing = comments.find(
      (c) => c.body.startsWith(marker) || c.body.startsWith(LEGACY_MARKER)
    );
    return existing?.id || null;
  }

  private async createComment(pr: PRIdentifier, body: string): Promise<void> {
    const url = `${this.apiUrl}/repos/${pr.repo}/issues/${pr.prNumber}/comments`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create GitHub comment: ${response.status} ${sanitizeErrorBody(error)}`);
    }
  }

  private async updateComment(commentId: number, body: string): Promise<void> {
    const url = `${this.apiUrl}/repos/${this.repo}/issues/comments/${commentId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update GitHub comment: ${response.status} ${sanitizeErrorBody(error)}`);
    }
  }
}
