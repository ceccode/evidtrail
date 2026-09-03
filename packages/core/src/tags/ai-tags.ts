export type AILevel = 'explicit' | 'implicit' | 'mention' | 'none';

// PRIMARY AXIS 1 — involvement (#25): what level of AI participated. The
// durable dimension in an AI-first world, where "was AI involved" trends
// toward "yes" and stops discriminating anything.
export type AIMode = 'none' | 'autocomplete' | 'assisted' | 'agent' | 'unknown';

// PRIMARY AXIS 2 — evidence (#25): how we know. 'declared' = someone stated
// it (AI-Mode trailer, manifest); 'inferred' = we concluded it from tool
// identity or commit structure — real signal, our conclusion; 'none' = no
// signal at all, which is what the old `attribution: 'unknown'` meant.
//
// The two axes are orthogonal: `mode: 'unknown', evidence: 'inferred'` is a
// real state — we know AI participated, we cannot say at what level.
export type Evidence = 'declared' | 'inferred' | 'none';

// DERIVED — the three-state projection (#34, #39), kept because a headline
// needs one word. Never decided independently of the axes above: see
// `projectAttribution`. 'automated' is provenance-known automation (merge
// commits, release bots) — it counts toward coverage but joins no cohort,
// because automation is not authored code.
export type Attribution = 'ai' | 'human' | 'automated' | 'unknown';

export interface AutonomyAxes {
  mode: AIMode;
  evidence: Evidence;
  automated: boolean;
}

// The whole three-state model, in one function. Everything it reads is on
// the two primary axes; nothing else in evidtrail may decide an attribution.
export function projectAttribution({ mode, evidence, automated }: AutonomyAxes): Attribution {
  // Automation is orthogonal to autonomy: known provenance, no author.
  if (automated) return 'automated';
  // No signal either way. The absence of evidence is not evidence of a human.
  if (evidence === 'none') return 'unknown';
  // Someone stated, or we inferred, that no AI participated.
  if (mode === 'none') return 'human';
  // autocomplete | assisted | agent, or 'unknown' with a signal behind it:
  // AI participated, even where we cannot name the level.
  return 'ai';
}

// Tool identity → coarse autonomy mode. Deliberately rough: a trailer names
// the tool, not the session mode. First match wins; multi-word names before
// their prefixes ('claude code' before 'claude').
export const MODE_BY_TOOL: Array<[pattern: RegExp, mode: AIMode]> = [
  [/\bclaude\s+code\b/i, 'agent'],
  // GitHub's autonomous coding agent, which opens its own PRs — must be
  // matched before the bare `copilot` rule.
  [/\bcopilot[-\s]?swe[-\s]?agent\b/i, 'agent'],
  // A tool name proves involvement, not autonomy. Only declarations
  // (AI-Mode) or unambiguous product identities may name a mode.
  [/\b(copilot|claude|cursor|windsurf|codeium|chatgpt|gemini)\b/i, 'unknown'],
];

// Commit-time declared mode (#61): `AI-Mode: agent` written by the
// prepare-commit-msg hook. A declaration beats inference — this is the
// mechanism that turns `declared` from exception into norm.
const DECLARED_MODE_TRAILER = /^AI-Mode:\s*(none|autocomplete|assisted|agent)\s*$/im;

export function declaredMode(message: string): AIMode | null {
  const match = message.match(DECLARED_MODE_TRAILER);
  return match ? (match[1].toLowerCase() as AIMode) : null;
}

export function inferMode(message: string): AIMode {
  for (const [pattern, mode] of MODE_BY_TOOL) {
    if (pattern.test(message)) {
      return mode;
    }
  }
  return 'unknown';
}

export interface AITagResult extends AutonomyAxes {
  // Derived from the axes above by `projectAttribution`
  attribution: Attribution;
  level: AILevel;
  sources: string[];
}

// Single construction point for a tag, so `attribution` can never drift out
// of agreement with the axes it is supposed to project.
export function tagFromAxes(
  axes: AutonomyAxes,
  level: AILevel,
  sources: string[]
): AITagResult {
  return { ...axes, attribution: projectAttribution(axes), level, sources };
}

export interface AITagConfig {
  patterns: string[];
  tools?: string[];
  trailerDomains?: string[];
  botBlocklist?: string[];
}

export const DEFAULT_TOOLS = ['copilot', 'cursor', 'windsurf', 'codeium', 'claude', 'chatgpt', 'gemini'];

// Domains that identify an AI co-author. Deliberately does NOT include
// `github.com`: `@users.noreply.github.com` is the default email of every
// GitHub account, so matching it flags ordinary humans who co-authored a
// commit through the web UI as AI. Found by running evidtrail against
// commander.js, where 2 of 3 "AI" detections were humans. AI bots hosted on
// GitHub (copilot, copilot-swe-agent) are still caught by the `.*bot.*`
// trailer rule and by tool-name matching.
const DEFAULT_TRAILER_DOMAINS = ['anthropic', 'openai'];

// Known non-AI automation bots. Now that an AI co-author must name a tool,
// this is no longer the first line of defence against bot false positives —
// it stays because it also drives `automated` detection for bot-authored
// commits (#39), and still strips a blocklisted bot's trailer before the
// tool-name rule sees it.
export const DEFAULT_BOT_BLOCKLIST = [
  'dependabot',
  'renovate',
  'github-actions',
  'greenkeeper',
  'snyk-bot',
  'mergify',
  'imgbot',
  'allcontributors',
];

function buildPatterns(tools: string, domains: string) {
  return {
    explicitTag: '\\[ai\\]',
    explicitVerbs: [
      `(generated|created|written|built|authored|produced)\\s+(by|with|using)\\s+\\b(${tools})\\b`,
      `\\b(${tools})\\b\\s+(generated|created|wrote|built|authored|produced)`,
    ],
    trailers: [
      '^AI:\\s*true$',
      '^X-AI:\\s*true$',
      // A co-author must NAME an AI tool to count as AI evidence. The rule
      // used to be `.*bot.*`, which reads "a bot participated" as "AI wrote
      // this" — two different claims. Found by running evidtrail against babel,
      // where 47 of 52 "AI" commits were ordinary PRs co-authored by
      // "Babel Bot", the project's own formatting/release bot. Every one of
      // them came out with mode 'unknown': the tagger already knew it could
      // not name a tool, and asserted AI anyway.
      //
      // Named AI bots are unaffected — `copilot[bot]` and
      // `copilot-swe-agent[bot]` match on the tool name, not on "bot".
      `^Co-authored-by:.*\\b(${tools})\\b.*$`,
      `^Co-authored-by:.*\\b(${domains})\\b.*$`,
    ],
    implicit: [
      `\\b(${tools})\\b\\s+(suggestions?|assisted|helped|recommended|review)`,
      `(suggested|assisted|helped|reviewed|recommended)\\s+(by|with|from)\\s+\\b(${tools})\\b`,
      `(with\\s+help\\s+from|with\\s+assistance\\s+from)\\s+\\b(${tools})\\b`,
    ],
    mentionContext: [
      `(fix|add|remove|disable|enable|configure|update|install|setup|document|test)\\b.*\\b(${tools})\\b`,
      `\\b(${tools})\\b\\s+(support|integration|config|configuration|setup|plugin|extension|bug|issue|error|detection|pattern|rule)`,
    ],
    toolName: `\\b(${tools})\\b`,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function compileCustomPattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'im');
  } catch (error) {
    throw new Error(
      'Invalid AI detection regex ' +
        JSON.stringify(pattern) +
        ': ' +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

export function createAITagger(
  config: AITagConfig = { patterns: [] }
): (message: string) => AITagResult {
  // Merge default tools with user-provided tools
  const allTools = [...DEFAULT_TOOLS, ...(config.tools || [])];
  const toolsPattern = allTools.map(escapeRegex).join('|');

  // Merge default trailer domains with user-provided domains
  const allDomains = [...DEFAULT_TRAILER_DOMAINS, ...(config.trailerDomains || [])];
  const domainsPattern = allDomains.map(escapeRegex).join('|');

  // Merge default bot blocklist with user-provided entries
  const allBlocked = [...DEFAULT_BOT_BLOCKLIST, ...(config.botBlocklist || [])];
  const blockedLineRegex = allBlocked.length
    ? new RegExp(
        `^Co-authored-by:.*\\b(${allBlocked.map(escapeRegex).join('|')})\\b`,
        'i'
      )
    : null;

  const p = buildPatterns(toolsPattern, domainsPattern);

  const explicitTagRegex = new RegExp(p.explicitTag, 'im');
  const explicitVerbRegexes = p.explicitVerbs.map((s) => new RegExp(s, 'im'));
  const trailerRegexes = p.trailers.map((s) => new RegExp(s, 'mi'));
  const implicitRegexes = p.implicit.map((s) => new RegExp(s, 'im'));
  const mentionContextRegexes = p.mentionContext.map((s) => new RegExp(s, 'im'));
  const toolNameRegex = new RegExp(p.toolName, 'im');
  const customRegexes = config.patterns.map(compileCustomPattern);

  return (message: string): AITagResult => {
    const sources: string[] = [];
    let level: AILevel = 'none';

    // Strip Co-authored-by lines from blocklisted non-AI bots so they can't
    // trigger explicit classification via the generic bot/domain trailers.
    const trailerText = blockedLineRegex
      ? message
          .split('\n')
          .filter((line) => !blockedLineRegex.test(line))
          .join('\n')
      : message;

    // 1. Check trailers (always explicit)
    for (let i = 0; i < trailerRegexes.length; i++) {
      if (trailerRegexes[i].test(trailerText)) {
        level = 'explicit';
        sources.push(`trailer:${p.trailers[i]}`);
      }
    }

    // 2. Check [AI] tag (explicit)
    if (explicitTagRegex.test(message)) {
      level = 'explicit';
      sources.push('tag:[ai]');
    }

    // 3. Check creation verb + tool (explicit)
    for (const regex of explicitVerbRegexes) {
      if (regex.test(message)) {
        level = 'explicit';
        sources.push(`explicit_verb:${regex.source}`);
      }
    }

    // 4. Check custom patterns (treated as explicit)
    for (const regex of customRegexes) {
      if (regex.test(message)) {
        level = 'explicit';
        sources.push(`custom:${regex.source}`);
      }
    }

    // If already explicit, skip lower-level checks
    if (level !== 'explicit') {
      // 5. Check implicit patterns first (higher priority than mention)
      let isImplicit = false;
      for (const regex of implicitRegexes) {
        if (regex.test(message)) {
          isImplicit = true;
          sources.push(`implicit:${regex.source}`);
        }
      }

      // 6. Check mention context (only if not implicit)
      let isMention = false;
      if (!isImplicit) {
        for (const regex of mentionContextRegexes) {
          if (regex.test(message)) {
            isMention = true;
            sources.push(`mention_context:${regex.source}`);
          }
        }
      }

      // 7. Check bare tool name (fallback)
      const hasToolName = toolNameRegex.test(message);

      if (isImplicit) {
        level = 'implicit';
      } else if (isMention) {
        level = 'mention';
      } else if (hasToolName) {
        level = 'mention';
        sources.push('tool_name_only');
      }
    }

    // The two axes are settled here, in order of evidence strength, and the
    // three-state attribution falls out of them (#25). Nothing below decides
    // "is this AI?" directly — that question is now a projection.

    // 1. Declared. `AI-Mode: agent` states an agent wrote this; `AI-Mode:
    //    none` states a human did (#61). A declaration outranks everything.
    const declared = declaredMode(message);
    if (declared) {
      sources.push('trailer:AI-Mode');
      return tagFromAxes(
        { mode: declared, evidence: 'declared', automated: false },
        // A declared mode is itself explicit evidence, except `none`, which
        // asserts absence and leaves the message heuristics to speak
        declared === 'none' ? level : 'explicit',
        sources
      );
    }

    // 2. No AI signal in the message. Not a human commit — just no signal,
    //    which is exactly what `evidence: 'none'` means.
    const hasAISignal = level === 'explicit' || level === 'implicit';
    if (!hasAISignal) {
      return tagFromAxes({ mode: 'unknown', evidence: 'none', automated: false }, level, sources);
    }

    // 3. AI participated. `inferMode` names the level when the message names
    //    a tool; when it does not, the level stays 'unknown' while the
    //    evidence remains 'inferred' — we did conclude something, just not
    //    the autonomy level. That pairing is the reason the axes are
    //    separate: the old model had to call this state 'no evidence'.
    return tagFromAxes(
      { mode: inferMode(message), evidence: 'inferred', automated: false },
      level,
      sources
    );
  };
}
