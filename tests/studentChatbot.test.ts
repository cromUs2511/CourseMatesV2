import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerStudentChatMessage,
  createStudentChatbotState,
  levenshteinDistance,
  normalizeStudentChatMessage,
  replayStudentChatHistory,
  tokenizeStudentChatMessage,
} from '../studentChatbot';
import { STUDENT_CHATBOT_KNOWLEDGE } from '../studentChatbotKnowledge';

function ask(messages: string[]): { replies: string[]; lastIntent: string } {
  const state = createStudentChatbotState();
  const replies: string[] = [];
  let lastIntent = '';
  for (const message of messages) {
    const answer = answerStudentChatMessage(message, state);
    replies.push(answer.reply);
    lastIntent = answer.intentId;
  }
  return { replies, lastIntent };
}

test('knowledge base entries are well-formed and unique', () => {
  const ids = new Set<string>();
  for (const entry of STUDENT_CHATBOT_KNOWLEDGE) {
    assert.ok(entry.id, 'entry needs an id');
    assert.ok(entry.category, 'entry needs a category');
    assert.ok(entry.keywords.length > 0, `${entry.id} needs keywords`);
    assert.equal(ids.has(entry.id), false, `duplicate intent id ${entry.id}`);
    ids.add(entry.id);
    if (!entry.slot) assert.ok(entry.responses.length >= 2, `${entry.id} needs response variants`);
  }
});

test('normalizer expands slang, contractions, and spelling variants', () => {
  assert.equal(normalizeStudentChatMessage("What's up??"), 'what is up');
  assert.equal(normalizeStudentChatMessage('I dunno how 2 enrol!!!'), 'i do not know how 2 enrol');
  assert.deepEqual(tokenizeStudentChatMessage('enrolment reqs pls'), ['enrollment', 'requirement']);
});

test('fuzzy matching tolerates misspellings without regex backtracking', () => {
  assert.equal(levenshteinDistance('scedule', 'schedule'), 1);
  assert.equal(levenshteinDistance('requirment', 'requirement'), 1);
  const start = performance.now();
  const { lastIntent } = ask(['wat is my scedule for teh semestar']);
  assert.equal(lastIntent, 'schedule');
  assert.ok(performance.now() - start < 1000);
});

test('same question in different phrasings reaches the same intent', () => {
  const variants = [
    'how do i enroll',
    'How do I ENROLL??',
    'can u tell me how to register',
    'i wanna sign up for classes',
  ];
  for (const variant of variants)
    assert.equal(ask([variant]).lastIntent, 'enrollment_process', variant);
  for (const variant of ['send study tips', 'how should i study for calculus', 'i cant focus'])
    assert.equal(ask([variant]).lastIntent, 'study_tips', variant);
});

test('enrollment requirements use a clarification turn, like the spec example', () => {
  const state = createStudentChatbotState();
  const first = answerStudentChatMessage("I'm having trouble with enrollment.", state);
  assert.equal(first.intentId, 'enrollment_process');
  const second = answerStudentChatMessage('The requirements.', state);
  assert.equal(second.intentId, 'enrollment_requirements');
  assert.match(second.reply, /new student or a returning student/);
  const third = answerStudentChatMessage('new student', state);
  assert.equal(third.intentId, 'enrollment_requirements_new');
});

test('follow-up questions reuse the conversation topic', () => {
  const { replies, lastIntent } = ask(['how do i study effectively', 'what about calculus']);
  assert.equal(lastIntent, 'topic_continue');
  assert.match(replies[1]!, /calculus/i);
  assert.match(replies[1]!, /understanding the topic/);
});

test('changing the subject mid-clarification switches cleanly', () => {
  const state = createStudentChatbotState();
  answerStudentChatMessage('what are the requirements', state);
  const answer = answerStudentChatMessage('actually, where is the library', state);
  assert.equal(answer.intentId, 'library');
});

test('ambiguous one-word questions ask for clarification instead of guessing', () => {
  const { replies, lastIntent } = ask(['class']);
  assert.equal(lastIntent, 'clarify');
  assert.match(replies[0]!, /Which one did you mean/);
});

test('tuition questions point at the finance office, never invented dates', () => {
  const { replies, lastIntent } = ask(['what is the exact tuition deadline for next semester']);
  assert.equal(lastIntent, 'fees');
  assert.match(replies[0]!, /finance/);
  for (const entry of STUDENT_CHATBOT_KNOWLEDGE)
    for (const response of entry.responses)
      assert.doesNotMatch(
        response,
        /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/,
        `${entry.id} must not invent dates`,
      );
});

test('repeated fallbacks escalate toward human support', () => {
  const { replies } = ask(['quantum banana policy seven', 'blorp fnord quux']);
  assert.match(replies[0]!, /do not have a programmed answer/);
  assert.match(replies[0]!, /registrar or campus support desk/);
  assert.match(replies[1]!, /real person/);
});

test('responses vary across repeats instead of echoing robotically', () => {
  const { replies } = ask(['hello', 'hi there', 'hey']);
  assert.equal(new Set(replies).size, 3);
});

test('name memory is conversational by default and consented when asked', () => {
  const state = createStudentChatbotState();
  const intro = answerStudentChatMessage('my name is Ana', state);
  assert.match(intro.reply, /Ana/);
  assert.equal(state.rememberAllowed, false);
  const remember = answerStudentChatMessage('remember me', state);
  assert.equal(state.rememberAllowed, true);
  assert.match(remember.reply, /forget me/);
  const forgotten = answerStudentChatMessage('forget me please', state);
  assert.equal(state.userName, null);
  assert.equal(state.rememberAllowed, false);
  assert.match(forgotten.reply, /cleared/);
});

test('history replay restores topic context for the next message', () => {
  const state = createStudentChatbotState();
  replayStudentChatHistory(
    [
      { role: 'user', text: 'how do i study effectively' },
      { role: 'assistant', text: 'Try focused blocks.' },
    ],
    state,
  );
  const answer = answerStudentChatMessage('what about physics', state);
  assert.equal(answer.intentId, 'topic_continue');
  assert.match(answer.reply, /physics/i);
});

test('empty messages are handled gracefully', () => {
  assert.equal(ask(['   ']).lastIntent, 'empty');
});
