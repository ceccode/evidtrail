import type { CIProvider, PRIdentifier } from './types.js';

// GitLab CI provider for `evidtrail comment` (#16).
//
// Mirrors the GitHub provider: find an existing evidtrail note by marker and
// update it, or create one — so re-running on a pushed branch edits the
// same note instead of spamming the merge request.

const MARKER = '<!-- evidtrail-report -->';
// Notes posted before the rename carry the old marker; see the GitHub provider.
const LEGACY_MARKER = '<!-- aida-metrics-report -->';

function sanitizeErrorBody(text: string, maxLength = 200): string {
  // GitLab tokens: glpat- (PAT), gloas- (OAuth), plus the CI job token
  let sanitized = text
    .replace(/gl(pat|oas|soat|ptt|rt)-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(PRIVATE-TOKEN|JOB-TOKEN)\s*:?\s*[A-Za-z0-9._-]+/gi, '$1: [REDACTED]');
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '...(truncated)';
  }
  return sanitized;
}

export class GitLabProvider implements CIProvider {
  name = 'gitlab';

  // GITLAB_TOKEN is a personal/project token; CI_JOB_TOKEN cannot post
  // notes, so it is deliberately not used as a fallback — failing with a
  // clear message beats a confusing 401 at post time.
  private get token(): string {
    const token = process.env.GITLAB_TOKEN;
    if (!token) {
      throw new Error(
        'GITLAB_TOKEN is required for GitLab MR comments (CI_JOB_TOKEN cannot post notes). ' +
          'Add a project or group access token with the `api` scope.'
      );
    }
    return token;
  }

  private get projectId(): string {
    const id = process.env.CI_PROJECT_ID;
    if (!id) {
      throw new Error('CI_PROJECT_ID env var not found. Are you running in GitLab CI?');
    }
    return id;
  }

  private get apiUrl(): string {
    return process.env.CI_API_V4_URL || 'https://gitlab.com/api/v4';
  }

  private get headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token,
      'Content-Type': 'application/json',
    };
  }

  getPRIdentifier(): PRIdentifier | null {
    // Set on merge_request_event pipelines only — a branch pipeline has no MR
    const iid = process.env.CI_MERGE_REQUEST_IID;
    if (!iid) return null;

    return {
      provider: 'gitlab',
      prNumber: iid,
      repo: process.env.CI_PROJECT_PATH || this.projectId,
    };
  }

  async postComment(content: string, marker: string = MARKER): Promise<void> {
    const mr = this.getPRIdentifier();
    if (!mr) {
      throw new Error(
        'Could not determine the merge request IID. Is this a merge_request_event pipeline?'
      );
    }

    const markedContent = `${marker}\n${content}`;
    const existingId = await this.findExistingNote(mr.prNumber, marker);

    if (existingId) {
      await this.updateNote(mr.prNumber, existingId, markedContent);
    } else {
      await this.createNote(mr.prNumber, markedContent);
    }
  }

  private notesUrl(iid: string): string {
    return `${this.apiUrl}/projects/${encodeURIComponent(this.projectId)}/merge_requests/${iid}/notes`;
  }

  private async findExistingNote(iid: string, marker: string): Promise<number | null> {
    const response = await fetch(`${this.notesUrl(iid)}?per_page=100`, {
      headers: this.headers,
    });

    if (!response.ok) return null;

    const notes = (await response.json()) as Array<{ id: number; body: string }>;
    return (
      notes.find((note) => note.body.startsWith(marker) || note.body.startsWith(LEGACY_MARKER))
        ?.id ?? null
    );
  }

  private async createNote(iid: string, body: string): Promise<void> {
    const response = await fetch(this.notesUrl(iid), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to create GitLab note: ${response.status} ${sanitizeErrorBody(error)}`
      );
    }
  }

  private async updateNote(iid: string, noteId: number, body: string): Promise<void> {
    const response = await fetch(`${this.notesUrl(iid)}/${noteId}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to update GitLab note: ${response.status} ${sanitizeErrorBody(error)}`
      );
    }
  }
}
