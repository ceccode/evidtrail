// Finds the comment evidtrail posted earlier, so a rerun edits it instead of
// adding another. Both GitHub and GitLab return comments 100 at a time; a
// search that stops at the first page misses the marker on a long review and
// posts a second report, after which every run updates whichever copy it
// happens to find.

export const COMMENT_PAGE_SIZE = 100;

// 100 pages = 10,000 comments. A bound, so a misbehaving API that never
// returns a short page cannot keep CI fetching forever.
const MAX_PAGES = 100;

interface Comment {
  id: number;
  body: string;
}

// `fetchPage` returns null when the API refuses the request: the caller then
// creates a new comment, as it did before pagination existed.
export async function findMarkedComment(
  fetchPage: (page: number) => Promise<Comment[] | null>,
  marker: string
): Promise<number | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const comments = await fetchPage(page);
    if (!comments) return null;
    const existing = comments.find((comment) => comment.body.startsWith(marker));
    if (existing) return existing.id;
    if (comments.length < COMMENT_PAGE_SIZE) return null;
  }
  return null;
}
