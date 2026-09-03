// Readable error text for the CLI's top-level catch blocks.
//
// A failing git command puts its whole output in the error message: simple-git
// and `child_process.exec` both do this. On a large repo that is not a
// message, it is a data dump — a broken `git log --numstat` over babel printed
// 22MB of per-file statistics with the one useful line, `fatal: unable to read
// <object>`, buried somewhere inside it. Found while running evidtrail against
// babel, where diagnosing a bad clone took far longer than it should have.
//
// git puts the actual diagnosis on lines prefixed `fatal:` or `error:`, so
// when those exist they are the message and everything else is noise.

const DIAGNOSTIC_LINE = /^\s*(fatal|error):/i;

// Long enough for a real stack or a multi-line git complaint, short enough to
// stay readable in a CI log.
const MAX_LENGTH = 1500;

export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  const diagnostics = raw.split('\n').filter((line) => DIAGNOSTIC_LINE.test(line));
  if (diagnostics.length > 0) {
    return truncate(diagnostics.join('\n'));
  }

  return truncate(raw.trim());
}

function truncate(text: string): string {
  if (text.length <= MAX_LENGTH) return text;
  const omitted = text.length - MAX_LENGTH;
  return `${text.slice(0, MAX_LENGTH)}\n… (${omitted} more characters omitted)`;
}
