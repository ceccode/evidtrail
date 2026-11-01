// `AI-Session: <agent>/<id>` points from a commit to the agent session that
// produced it. The commit hook writes it when the person committing opts
// in (`git config evidtrail.recordSession true`). Git holds the result of
// a session and nothing of what happened inside it: what was tried, what
// failed, what was fixed before anything was committed. This trailer gives that evidence an address.
//
// The id is opaque. evidtrail never reads a transcript; `trail` only says
// whether one with this id exists on the machine it runs on.

export interface SessionRef {
  agent: string;
  id: string;
}

// Both parts are restricted to filename-safe characters, so a crafted
// trailer can never become a path outside the agent's session store.
const SESSION_TRAILER = /^AI-Session:[ \t]*([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)[ \t]*$/im;

export function sessionRef(message: string): SessionRef | null {
  const match = message.match(SESSION_TRAILER);
  if (!match) return null;
  const [, agent, id] = match;
  // `.` and `..` match the character class and are directory names, not ids.
  if (id === '.' || id === '..' || agent === '.' || agent === '..') return null;
  return { agent: agent.toLowerCase(), id };
}
