import { createHash, randomBytes } from 'crypto';

// Author redaction (#35). evidtrail compares cohorts of commits, never people, and
// never emits per-author aggregates. But `commit-stream.json` carries author
// and committer identities, and that file travels: committed to CI, uploaded
// as a workflow artifact. A per-developer ranking is one `jq` query away.
//
// Redaction replaces identities with a salted hash. The salt is random per
// run, so hashes stay stable *within* one output file (dedup and per-identity
// grouping still work) but cannot be matched back to a person, nor correlated
// across runs by anyone holding a list of candidate emails.
//
// Detection that depends on identity (bot/automated, #39, #21) must run
// BEFORE redaction — see collectCommits.

export interface Redactor {
  name(value: string): string;
  email(value: string): string;
}

function digest(salt: string, value: string): string {
  return createHash('sha256')
    .update(salt)
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 12);
}

export function createRedactor(salt: string = randomBytes(16).toString('hex')): Redactor {
  return {
    name: (value: string) => `redacted-${digest(salt, value)}`,
    // .invalid is reserved (RFC 2606): a redacted address can never resolve
    email: (value: string) => `${digest(salt, value)}@redacted.invalid`,
  };
}
