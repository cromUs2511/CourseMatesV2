/** Rule-based student chatbot engine: the offline fallback for the
 * Student Chatbot Assistant when the Gemini/Groq provider is exhausted,
 * unreachable, or unconfigured.
 *
 * Strictly deterministic, no AI models, no network calls. The pipeline is
 * split into small stages so each can be tested in isolation:
 * normalize -> tokenize (synonyms) -> score (keywords, phrases, fuzzy match)
 * -> context (topic boost, clarification slots) -> respond (rotating
 * templates) -> fallback (suggestions + human handoff).
 *
 * Conversation memory: transient topic/slot state is rebuilt by replaying the
 * recent history the client already sends with each request, so multi-turn
 * context survives even without server-side session storage. Anything stored
 * longer (a name, only with explicit consent) lives in the single Node
 * process like the rest of the runtime and is cleared with `forget`.
 */

import {
  STUDENT_CHATBOT_KNOWLEDGE,
  STUDENT_CHATBOT_SLOTS,
  type StudentChatbotKnowledgeEntry,
  type StudentChatbotSlot,
} from './studentChatbotKnowledge';

export type StudentChatbotTurn = { role: 'user' | 'assistant'; text: string };

export type StudentChatbotState = {
  topic: string | null;
  pendingSlot: string | null;
  lastIntentId: string | null;
  counts: Record<string, number>;
  consecutiveFallbacks: number;
  userName: string | null;
  rememberAllowed: boolean;
};

export type StudentChatbotAnswer = {
  reply: string;
  intentId: string;
  verified: boolean;
};

export function createStudentChatbotState(): StudentChatbotState {
  return {
    topic: null,
    pendingSlot: null,
    lastIntentId: null,
    counts: {},
    consecutiveFallbacks: 0,
    userName: null,
    rememberAllowed: false,
  };
}

/** Common contractions, slang, and spelling variants expanded before matching. */
const NORMALIZATION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bi['’]m\b/g, 'i am'],
  [/\bi['’]ve\b/g, 'i have'],
  [/\bi['’]ll\b/g, 'i will'],
  [/\bdon['’]t\b/g, 'do not'],
  [/\bdoesn['’]t\b/g, 'does not'],
  [/\bdidn['’]t\b/g, 'did not'],
  [/\bcan['’]t\b/g, 'cannot'],
  [/\bcouldn['’]t\b/g, 'could not'],
  [/\bwon['’]t\b/g, 'will not'],
  [/\bisn['’]t\b/g, 'is not'],
  [/\baren['’]t\b/g, 'are not'],
  [/\bwhat['’]s\b/g, 'what is'],
  [/\bhow['’]s\b/g, 'how is'],
  [/\bit['’]s\b/g, 'it is'],
  [/\bthat['’]s\b/g, 'that is'],
  [/\bthere['’]s\b/g, 'there is'],
  [/\bgonna\b/g, 'going to'],
  [/\bwanna\b/g, 'want to'],
  [/\bgotta\b/g, 'got to'],
  [/\blemme\b/g, 'let me'],
  [/\bdunno\b/g, 'do not know'],
  [/\bya\b/g, 'you'],
  [/\bu\b/g, 'you'],
  [/\bur\b/g, 'your'],
  [/\br\b/g, 'are'],
  [/\bpls\b/g, 'please'],
  [/\bplz\b/g, 'please'],
  [/\bthx\b/g, 'thanks'],
  [/\btho\b/g, 'though'],
  [/\bbc\b/g, 'because'],
  [/\bw\/\b/g, 'with'],
  [/\bprof\b/g, 'professor'],
  [/\buni\b/g, 'university'],
  [/\bdorm\b/g, 'dormitory'],
];

/** Variant token -> canonical token, so synonyms score as the same keyword. */
const SYNONYMS: Record<string, string> = {
  enrol: 'enroll',
  enrolment: 'enrollment',
  enrolments: 'enrollment',
  enrollments: 'enrollment',
  registering: 'register',
  registration: 'register',
  admissions: 'admission',
  applying: 'apply',
  requirements: 'requirement',
  reqs: 'requirement',
  docs: 'document',
  papers: 'document',
  classes: 'class',
  courses: 'course',
  subjects: 'subject',
  subject: 'subject',
  timetables: 'timetable',
  schedules: 'schedule',
  sched: 'schedule',
  exams: 'exam',
  tests: 'exam',
  quizzes: 'quiz',
  midterms: 'midterm',
  finals: 'finals',
  homeworks: 'homework',
  assignments: 'assignment',
  projects: 'project',
  deadlines: 'deadline',
  dormitory: 'housing',
  dorms: 'housing',
  cafeterias: 'cafeteria',
  canteens: 'cafeteria',
  counselors: 'counselor',
  counsellors: 'counselor',
  counselling: 'guidance',
  counseling: 'guidance',
  scholarships: 'scholarship',
  profs: 'professor',
  textbooks: 'book',
  ebooks: 'ebook',
  thankyou: 'thanks',
  thank: 'thanks',
  pls: 'please',
  plz: 'please',
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'i',
  'am',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'with',
  'you',
  'your',
  'do',
  'does',
  'did',
  'not',
  'no',
  'just',
  'very',
  'really',
  'please',
  'about',
  'there',
  'here',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'why',
  'can',
  'could',
  'should',
  'would',
  'will',
  'get',
  'got',
]);

const FOLLOW_UP_MARKERS = [
  'what about',
  'how about',
  'and what',
  'what if',
  'and the',
  'and my',
  'tell me more',
  'more about',
];

const MATCH_THRESHOLD = 1.5;
const AMBIGUITY_MARGIN = 0.5;
const MAX_HISTORY_REPLAY_TURNS = 6;

export function normalizeStudentChatMessage(raw: string): string {
  let text = (raw || '').toLowerCase();
  for (const [pattern, replacement] of NORMALIZATION_REPLACEMENTS)
    text = text.replace(pattern, replacement);
  return text
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeStudentChatMessage(normalized: string): string[] {
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean)
    .map((token) => SYNONYMS[token] ?? token)
    .filter((token) => !STOP_WORDS.has(token));
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function fuzzyDistance(token: string, keyword: string): number | null {
  if (token === keyword) return 0;
  if (token.length < 3 || keyword.length < 3) return null;
  const maxDistance = Math.max(token.length, keyword.length) <= 4 ? 1 : 2;
  const distance = levenshteinDistance(token, keyword);
  return distance <= maxDistance ? distance : null;
}

function fuzzyTokenMatch(token: string, keyword: string): boolean {
  return fuzzyDistance(token, keyword) !== null;
}

type ScoredEntry = { entry: StudentChatbotKnowledgeEntry; score: number };

function scoreEntries(tokens: string[], normalized: string): ScoredEntry[] {
  return STUDENT_CHATBOT_KNOWLEDGE.map((entry) => {
    let score = 0;
    for (const phrase of entry.phrases) if (normalized.includes(phrase)) score += 3;
    // Canonicalize keywords first so plural/synonym duplicates (deadline vs
    // deadlines) score once instead of stacking exact + fuzzy hits.
    const canonical = [...new Set(entry.keywords.map((keyword) => SYNONYMS[keyword] ?? keyword))];
    for (const keyword of canonical) {
      if (tokens.includes(keyword)) {
        score += 1.5;
        continue;
      }
      let closest: number | null = null;
      for (const token of tokens) {
        const distance = fuzzyDistance(token, keyword);
        if (distance !== null && (closest === null || distance < closest)) closest = distance;
      }
      // A one-letter typo in a long word is almost certainly that word.
      if (closest === 1 && keyword.length >= 6) score += 1.5;
      else if (closest !== null) score += 0.8;
    }
    return { entry, score };
  })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

function findSlot(id: string | null): StudentChatbotSlot | undefined {
  if (!id) return undefined;
  return STUDENT_CHATBOT_SLOTS.find((slot) => slot.id === id);
}

function renderResponse(entry: StudentChatbotKnowledgeEntry, state: StudentChatbotState): string {
  const variants = entry.responses.length ? entry.responses : ['How else can I help?'];
  const index = (state.counts[entry.id] ?? 0) % variants.length;
  state.counts[entry.id] = (state.counts[entry.id] ?? 0) + 1;
  const template = variants[index] ?? variants[0] ?? 'How else can I help?';
  return template.replaceAll('{name}', state.userName ? ` ${state.userName}` : '');
}

function answerEntry(
  entry: StudentChatbotKnowledgeEntry,
  state: StudentChatbotState,
): StudentChatbotAnswer {
  state.topic = entry.category;
  state.lastIntentId = entry.id;
  state.consecutiveFallbacks = 0;
  if (!entry.slot) state.pendingSlot = null;
  return { reply: renderResponse(entry, state), intentId: entry.id, verified: entry.verified };
}

function describeIntent(entry: StudentChatbotKnowledgeEntry): string {
  const hint = entry.phrases[0] ?? entry.keywords[0] ?? entry.id.replaceAll('_', ' ');
  return `${entry.category} (${hint})`;
}

const NAME_PATTERNS = [/\bmy name is ([a-z][a-z'-]{1,19})\b/, /\bcall me ([a-z][a-z'-]{1,19})\b/];

function extractName(normalized: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !STOP_WORDS.has(candidate))
      return candidate[0]!.toUpperCase() + candidate.slice(1);
  }
  return null;
}

const DATETIME_PATTERNS = [
  'what time is it',
  'current time',
  'what is the time',
  'today date',
  'what day is it',
  'what is today',
];

function tryDateTime(normalized: string, state: StudentChatbotState): StudentChatbotAnswer | null {
  if (!DATETIME_PATTERNS.some((pattern) => normalized.includes(pattern))) return null;
  const now = new Date();
  state.topic = 'general';
  state.lastIntentId = 'datetime';
  state.consecutiveFallbacks = 0;
  state.pendingSlot = null;
  return {
    reply: `It is ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} on ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}. Anything else I can help with?`,
    intentId: 'datetime',
    verified: true,
  };
}

function tryMemoryCommands(
  normalized: string,
  tokens: string[],
  state: StudentChatbotState,
): StudentChatbotAnswer | null {
  const mentionsForget = tokens.includes('forget') || normalized.includes('forget me');
  if (mentionsForget) {
    const hadMemory = state.userName !== null || state.rememberAllowed;
    state.userName = null;
    state.rememberAllowed = false;
    state.lastIntentId = 'forget';
    state.consecutiveFallbacks = 0;
    return {
      reply: hadMemory
        ? 'Done. I have cleared your name and preferences from my memory.'
        : 'There is nothing stored to clear. I only keep what you explicitly ask me to remember.',
      intentId: 'forget',
      verified: true,
    };
  }
  const mentionsRemember =
    tokens.includes('remember') ||
    normalized.includes('remember me') ||
    normalized.includes('remember this');
  const named = extractName(normalized);
  if (mentionsRemember) {
    state.rememberAllowed = true;
    if (named) state.userName = named;
    state.lastIntentId = 'remember';
    state.consecutiveFallbacks = 0;
    return {
      reply: state.userName
        ? `Got it, ${state.userName}. I will remember your name for our chats. Say "forget me" anytime to clear it. What else can I help with?`
        : 'Got it. I will remember your preferences for our chats. Say "forget me" anytime to clear them. What is your name?',
      intentId: 'remember',
      verified: true,
    };
  }
  if (named) {
    state.userName = named;
    state.lastIntentId = 'introduce';
    state.consecutiveFallbacks = 0;
    return {
      reply: `Nice to meet you, ${named}! I will use your name just for this chat. Say "remember me" if you want me to keep it for next time. What do you need help with?`,
      intentId: 'introduce',
      verified: true,
    };
  }
  return null;
}

function tryPendingSlot(
  normalized: string,
  tokens: string[],
  state: StudentChatbotState,
): StudentChatbotAnswer | null {
  const slot = findSlot(state.pendingSlot);
  if (!slot) return null;
  for (const option of slot.options) {
    const hit =
      option.phrases.some((phrase) => normalized.includes(phrase)) ||
      option.keywords.some(
        (keyword) =>
          tokens.includes(keyword) || tokens.some((token) => fuzzyTokenMatch(token, keyword)),
      );
    if (hit) {
      const entry = STUDENT_CHATBOT_KNOWLEDGE.find((item) => item.id === option.entryId);
      state.pendingSlot = null;
      if (entry) return answerEntry(entry, state);
    }
  }
  return null;
}

function clarificationReply(
  first: ScoredEntry,
  second: ScoredEntry,
  state: StudentChatbotState,
): StudentChatbotAnswer {
  state.lastIntentId = 'clarify';
  state.consecutiveFallbacks = 0;
  return {
    reply:
      `That could be about ${describeIntent(first.entry)}, or about ${describeIntent(second.entry)}. ` +
      'Which one did you mean?',
    intentId: 'clarify',
    verified: true,
  };
}

const TOPIC_FOLLOW_UPS: Record<string, string> = {
  enrollment: 'Is this about the process, the requirements, or your enrollment status?',
  academics: 'Is this about understanding the topic, picking subjects, or managing your workload?',
  campus: 'Is this about the library, or another campus service?',
  procedures: 'Could you say a little more about what you want to change?',
  general: 'Could you tell me a bit more about what you need?',
};

function topicContinuationReply(subject: string, state: StudentChatbotState): StudentChatbotAnswer {
  state.lastIntentId = 'topic_continue';
  state.consecutiveFallbacks = 0;
  const prompt = TOPIC_FOLLOW_UPS[state.topic ?? ''] ?? TOPIC_FOLLOW_UPS['general']!;
  return {
    reply: subject ? `Got it, ${subject}. ${prompt}` : prompt,
    intentId: 'topic_continue',
    verified: true,
  };
}

function fallbackReply(ranked: ScoredEntry[], state: StudentChatbotState): StudentChatbotAnswer {
  state.lastIntentId = 'fallback';
  state.consecutiveFallbacks += 1;
  const suggestions = ranked
    .slice(0, 3)
    .map((candidate) => candidate.entry.category)
    .filter((category, index, all) => all.indexOf(category) === index);
  const repeated =
    state.consecutiveFallbacks > 1
      ? ' I am still not finding it, so a real person is your best bet for this one.'
      : '';
  return {
    reply:
      `I do not have a programmed answer for that, and I will not guess about policies, deadlines, or records.${suggestions.length ? ` I can help with ${suggestions.join(', ')}.` : ''}` +
      ` Could you rephrase it, or pick one of those topics?${repeated} For anything official, your registrar or campus support desk can confirm it.`,
    intentId: 'fallback',
    verified: true,
  };
}

/** Answer one student message, updating the conversation state in place. */
export function answerStudentChatMessage(
  rawMessage: string,
  state: StudentChatbotState,
): StudentChatbotAnswer {
  const normalized = normalizeStudentChatMessage(rawMessage);
  if (!normalized)
    return {
      reply: 'I did not catch that. Could you write your question in words?',
      intentId: 'empty',
      verified: true,
    };
  const tokens = tokenizeStudentChatMessage(normalized);

  const memory = tryMemoryCommands(normalized, tokens, state);
  if (memory) return memory;

  const slotAnswer = tryPendingSlot(normalized, tokens, state);
  if (slotAnswer) return slotAnswer;

  const dateTime = tryDateTime(normalized, state);
  if (dateTime) return dateTime;

  let ranked = scoreEntries(tokens, normalized);
  if (state.pendingSlot) {
    // The student changed the subject instead of answering: drop the
    // pending question when the new message clearly matches elsewhere.
    const best = ranked[0];
    if (!best || best.score < MATCH_THRESHOLD) {
      const slot = findSlot(state.pendingSlot);
      return {
        reply: `${slot?.prompt ?? 'Which option did you mean?'} You can also just ask me something else.`,
        intentId: 'clarify_slot',
        verified: true,
      };
    }
    state.pendingSlot = null;
  }

  const isFollowUp =
    tokens.length <= 4 || FOLLOW_UP_MARKERS.some((marker) => normalized.includes(marker));
  if (isFollowUp && state.topic) {
    ranked = ranked
      .map((candidate) =>
        candidate.entry.category === state.topic
          ? { entry: candidate.entry, score: candidate.score + 1 }
          : candidate,
      )
      .sort((a, b) => b.score - a.score);
  }

  const best = ranked[0];
  if ((!best || best.score < MATCH_THRESHOLD) && isFollowUp && state.topic) {
    // Bare follow-up ("what about physics") with no keyword hit: stay on
    // topic and ask what about it, instead of dropping to fallback.
    return topicContinuationReply(tokens.slice(0, 3).join(' '), state);
  }
  if (!best || best.score < MATCH_THRESHOLD) return fallbackReply(ranked, state);
  const runnerUp = ranked[1];
  if (
    runnerUp &&
    runnerUp.score >= MATCH_THRESHOLD &&
    best.score - runnerUp.score <= AMBIGUITY_MARGIN
  )
    return clarificationReply(best, runnerUp, state);

  if (best.entry.slot) {
    const slot = findSlot(best.entry.slot);
    state.pendingSlot = best.entry.slot;
    state.lastIntentId = best.entry.id;
    state.topic = best.entry.category;
    state.consecutiveFallbacks = 0;
    return {
      reply: slot?.prompt ?? 'Could you tell me a bit more about what you need?',
      intentId: best.entry.id,
      verified: true,
    };
  }
  return answerEntry(best.entry, state);
}

/** Rebuild transient context from recent history (newest last). */
export function replayStudentChatHistory(
  history: StudentChatbotTurn[],
  state: StudentChatbotState,
): void {
  const userTexts = history
    .filter((turn) => turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim())
    .map((turn) => turn.text.slice(0, 1000))
    .slice(-MAX_HISTORY_REPLAY_TURNS);
  for (const text of userTexts) answerStudentChatMessage(text, state);
  state.counts = {};
}
