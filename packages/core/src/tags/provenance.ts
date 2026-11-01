import { AITagResult, createAITagger, tagFromAxes } from './ai-tags.js';
import { AutomatedCheckInput, createAutomatedDetector } from './automated.js';
import { applyManifest, ManifestIndex } from './attribution-manifest.js';
import { Logger } from '../utils/log.js';

export interface ProvenanceTaggerOptions {
  patterns: string[];
  tools: string[];
  trailerDomains: string[];
  botBlocklist: string[];
  manifestIndex: ManifestIndex | null;
  logger?: Logger;
}

export interface ProvenanceInput extends AutomatedCheckInput {
  hash: string;
  // The full message, body included: trailers live in the body.
  message: string;
}

// The whole provenance decision for one commit, in one place. `collect`
// runs it over the stream and `trail` runs it over a single commit. Two
// copies of this sequence would be two definitions of the same commit's
// provenance, and the day they drifted, the report and `trail` would
// disagree about a commit without either saying so.
export function createProvenanceTagger(
  options: ProvenanceTaggerOptions
): (commit: ProvenanceInput) => AITagResult {
  const aiTagger = createAITagger({
    patterns: options.patterns,
    tools: options.tools,
    trailerDomains: options.trailerDomains,
    botBlocklist: options.botBlocklist,
  });
  // Automated detection (#39): merge commits and bot authors
  const detectAutomated = createAutomatedDetector(options.botBlocklist);

  return (commit: ProvenanceInput): AITagResult => {
    let tag = aiTagger(commit.message);
    // Automated detection only when the message carried no signal at all:
    // in-commit evidence wins over structural heuristics. Automation sits
    // beside the autonomy axes rather than on them (#25) — a merge commit
    // has known provenance and no author, so `mode: none` states that no AI
    // wrote it while `automated` keeps it out of every cohort.
    if (tag.evidence === 'none') {
      const automatedSource = detectAutomated(commit);
      if (automatedSource) {
        tag = tagFromAxes({ mode: 'none', evidence: 'inferred', automated: true }, 'none', [
          ...tag.sources,
          automatedSource,
        ]);
      }
    }
    // Manifest declarations beat structural heuristics
    if (options.manifestIndex) {
      tag = applyManifest(tag, commit.hash, options.manifestIndex, options.logger);
    }
    return tag;
  };
}
