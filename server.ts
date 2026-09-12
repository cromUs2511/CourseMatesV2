import express from 'express';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { attachRuntime, authenticate, cookie, issueSession, isValidEmail } from './runtime';
import { DEFAULT_MUSIC_DIRECTORY, extractYouTubeVideoId } from './src/data/musicDirectory';
import { CHAT_SEND_BODY_LIMIT } from './src/data/chatImages';

dotenv.config({ path: ['.env.groq.local', '.env.gemini.local', '.env.local', '.env'] });
const app = express();
const PORT = Number(process.env.PORT || 3000);
const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || '';
if (!youtubeApiKey) {
  console.error('[config] Missing YOUTUBE_API_KEY. YouTube search is disabled until the environment variable is set.');
}
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const allowDemo = process.env.ALLOW_DEMO_LOGIN === 'true' || (!production && process.env.ALLOW_DEMO_LOGIN !== 'false');
const clientId = process.env.MICROSOFT_CLIENT_ID || '';
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';
const tenant = process.env.MICROSOFT_TENANT_ID || 'organizations';
const microsoftEnabled = Boolean(clientId && clientSecret);
app.disable('x-powered-by');
app.post('/api/chat/send', (req, res, next) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  next();
}, express.json({ limit: CHAT_SEND_BODY_LIMIT }));
app.use(express.json({ limit: '64kb' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const server = http.createServer(app);
const stopRuntime = attachRuntime(app, server);
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.Gemini_AI?.trim() || '';
const groqApiKey = process.env.GROQ_API_KEY?.trim() || '';
const groqModel = process.env.GROQ_MODEL?.trim() || 'groq/compound';
let ai: GoogleGenAI | null = null;
if (geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY') {
  ai = new GoogleGenAI({ apiKey: geminiApiKey, httpOptions: { timeout: 15000 } });
}
const configuredAiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
const aiModel = configuredAiModel === 'gemini-2.5-flash' ? 'gemini-3.6-flash' : configuredAiModel;
const oauthStates = new Map<string, { verifier: string; createdAt: number; profile: any }>();
const oauthCleanup = setInterval(() => {
  for (const [state, value] of oauthStates) if (Date.now() - value.createdAt > 600000) oauthStates.delete(state);
}, 60000);
oauthCleanup.unref();
function redirectUri(req: express.Request) {
  return (process.env.APP_URL || req.protocol + '://' + req.get('host')).replace(/\/$/, '') + '/auth/callback';
}
function sessionCookie(req: express.Request, res: express.Response, token: string) {
  res.cookie('cm_session', token, { httpOnly: true, sameSite: 'lax', secure: redirectUri(req).startsWith('https:'), path: '/', maxAge: 8 * 60 * 60 * 1000 });
}
app.get('/api/auth/config', (_req, res) => res.json({ microsoftEnabled, allowDemo }));
app.post(['/api/auth/school-email', '/api/auth/verify-school', '/api/auth/microsoft/verify-test'], (req, res) => {
  if (!allowDemo) return res.status(403).json({ error: 'Demo access is disabled. Sign in with Microsoft.' });
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const session = issueSession(email, req.body);
  sessionCookie(req, res, session.token);
  res.json({ success: true, session });
});
app.get(['/auth/microsoft/login', '/api/auth/microsoft/login', '/api/auth/microsoft/url'], (req, res) => {
  if (!microsoftEnabled) return res.status(503).json({ error: 'Microsoft sign-in is not configured.' });
  const state = crypto.randomBytes(32).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  oauthStates.set(state, { verifier, createdAt: Date.now(), profile: { campus: req.query.campus, discipline: req.query.discipline } });
  res.cookie('cm_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: redirectUri(req).startsWith('https:'), path: '/', maxAge: 600000 });
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(req),
    response_mode: 'query', scope: 'openid profile email', state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const url = 'https://login.microsoftonline.com/' + encodeURIComponent(tenant) + '/oauth2/v2.0/authorize?' + params;
  if (req.path.endsWith('/url')) res.json({ url, hasClientCredentials: true });
  else res.redirect(url);
});
app.get(['/auth/callback', '/api/auth/callback'], async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  res.clearCookie('cm_oauth_state', { path: '/' });
  const fail = (message: string) => res.redirect('/?auth_error=' + encodeURIComponent(message));
  if (!microsoftEnabled || !pending || cookie(req, 'cm_oauth_state') !== state || Date.now() - pending.createdAt > 600000) return fail('Sign-in expired. Please try again.');
  if (req.query.error || typeof req.query.code !== 'string') return fail('Microsoft sign-in was cancelled or failed.');
  try {
    const response = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(tenant) + '/oauth2/v2.0/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code',
        code: req.query.code, redirect_uri: redirectUri(req), code_verifier: pending.verifier }),
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) return fail('Microsoft sign-in failed. Please try again.');
    const userResponse = await fetch('https://graph.microsoft.com/oidc/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }, signal: AbortSignal.timeout(15000),
    });
    const user = await userResponse.json();
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!userResponse.ok || !isValidEmail(email)) return fail('Sign in with an account that provides a valid email address.');
    const session = issueSession(email, pending.profile, true);
    sessionCookie(req, res, session.token);
    res.redirect('/');
  } catch { return fail('Could not reach Microsoft. Please try again.'); }
});

const musicDirectory = DEFAULT_MUSIC_DIRECTORY.map(track => ({ ...track }));
app.get('/api/music/directory', (_req, res) => res.json({ tracks: musicDirectory, total: musicDirectory.length }));
app.get('/api/music/search', async (req, res) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Please sign in first.' });
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query.length < 2) return res.status(400).json({ error: 'Search for at least 2 characters.' });
  if (!youtubeApiKey) return res.status(503).json({ error: 'YouTube search is unavailable because YOUTUBE_API_KEY is missing.' });
  try {
    const params = new URLSearchParams({
      part: 'snippet', q: query, type: 'video', maxResults: '12', videoCategoryId: '10', key: youtubeApiKey,
    });
    const response = await fetch('https://www.googleapis.com/youtube/v3/search?' + params, { signal: AbortSignal.timeout(10000) });
    const data = await response.json() as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } } }> };
    if (!response.ok) return res.status(502).json({ error: 'YouTube search is temporarily unavailable.' });
    const tracks = (data.items || []).flatMap(item => {
      const videoId = item.id?.videoId;
      if (!videoId || !item.snippet?.title) return [];
      return [{
        id: 'youtube-search-' + videoId, title: item.snippet.title, artist: item.snippet.channelTitle || 'YouTube',
        youtubeUrl: 'https://www.youtube.com/watch?v=' + videoId, youtubeVideoId: videoId,
        category: 'custom' as const, thumbnail: item.snippet.thumbnails?.medium?.url,
      }];
    });
    res.json({ tracks });
  } catch {
    res.status(502).json({ error: 'Could not reach YouTube search.' });
  }
});
app.post('/api/music/directory', (req, res) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Please sign in first.' });
  const videoId = extractYouTubeVideoId(req.body.youtubeUrl);
  if (!videoId) return res.status(400).json({ error: 'Enter a valid YouTube link or video ID.' });
  const track = { id: crypto.randomUUID(), title: typeof req.body.title === 'string' ? req.body.title.slice(0, 160) : 'Community study track',
    artist: typeof req.body.artist === 'string' ? req.body.artist.slice(0, 100) : 'Community', category: 'custom' as const,
    youtubeUrl: 'https://www.youtube.com/watch?v=' + videoId, youtubeVideoId: videoId };
  musicDirectory.unshift(track);
  if (musicDirectory.length > 100) musicDirectory.pop();
  res.json({ success: true, track });
});
const DEFAULT_ICEBREAKERS: Record<string, string[]> = {
  academics: [
    "What's your toughest subject this term and what's making it tricky?",
    "Do you prefer morning 7:30 AM lectures or late afternoon laboratory blocks?",
    "How are you managing the fast-paced term schedule?",
    "What's one study hack or YouTube channel that saved your grade?",
    "Are you working on any cool course projects or capstone ideas right now?"
  ],
  campus: [
    "What's the best hidden food spot or coffee haven near your campus?",
    "Do you prefer studying at the library, student lounge, or off-campus cafes?",
    "How is the commute to campus treating you this week?",
    "What's your go-to comfort meal after a grueling 3-hour midterm exam?"
  ],
  career: [
    "What kind of industry or field are you hoping to enter after graduation?",
    "Have you started looking at OJT / internship opportunities yet?",
    "What tech stack or engineering software tools are you currently trying to learn?"
  ],
  stress_relief: [
    "On a scale of 1-10, how is your term stress level right now, and what helps you decompress?",
    "What video games, anime, music, or hobbies are currently keeping you sane?",
    "Take a deep breath! What is one small win you had this past week?"
  ]
};


app.use('/api/ai', (req, res, next) => {
  for (const key of ['topic', 'discipline', 'campus', 'query', 'action']) {
    if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 2000)) {
      return res.status(400).json({ error: 'Invalid ' + key + '.' });
    }
  }
  for (const key of ['recentMessages', 'chatHistory']) {
    if (req.body[key] !== undefined && (!Array.isArray(req.body[key]) || req.body[key].some((m: unknown) => !m || typeof m !== 'object'))) {
      return res.status(400).json({ error: 'Invalid conversation context.' });
    }
  }
  next();
});

app.post('/api/ai/icebreakers', async (req, res) => {
  const { topic, discipline, campus } = req.body;

  if (!ai) {
    const categoryList = DEFAULT_ICEBREAKERS[topic as keyof typeof DEFAULT_ICEBREAKERS] || DEFAULT_ICEBREAKERS.academics;
    return res.json({
      icebreakers: categoryList.slice(0, 4),
      topicSuggestions: [
        'Compare study workflows',
        'Share term survival tips',
        'Discuss dream capstone projects',
        'Recommend campus study spots'
      ],
      encouragingNote: 'Verified peer connected! Feel free to pick any icebreaker to kick off the conversation without awkwardness.'
    });
  }

  try {
    const prompt = `You are the Intelligent Conversation Assistant for "CourseMates", an anonymous peer platform for college students.
Context:
- Selected match topic: ${topic || 'General Peer Discovery'}
- Campus context: ${campus || 'Main Campus'}
- Disciplines involved: Engineering, Computer Science, Architecture, Business, Arts, etc.
- Culture note: Students deal with intense, fast-paced academic terms, high-stakes project submissions, calculus/physics hurdles, and lively campus life.

Task:
Generate 4 natural, engaging, friendly, low-stress icebreakers/conversation starters that eliminate social anxiety.
Also provide 4 follow-up discussion topics and 1 short encouraging student tip.

Return ONLY a JSON object formatted strictly as:
{
  "icebreakers": ["question 1", "question 2", "question 3", "question 4"],
  "topicSuggestions": ["topic 1", "topic 2", "topic 3", "topic 4"],
  "encouragingNote": "short warm note"
}`;

    const response = await ai.models.generateContent({
      model: aiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error) {
    console.error('Error generating AI icebreakers:', error);
    const categoryList = DEFAULT_ICEBREAKERS[topic as keyof typeof DEFAULT_ICEBREAKERS] || DEFAULT_ICEBREAKERS.academics;
    res.json({
      icebreakers: categoryList.slice(0, 4),
      topicSuggestions: [
        'Compare study workflows',
        'Share term survival tips',
        'Discuss dream capstone projects',
        'Recommend campus study spots'
      ],
      encouragingNote: 'Verified peer connected! Break the ice with one of the prompts below.'
    });
  }
});

// Topic-aware conversation starters, with local fallback.
app.post('/api/ai/suggestions', async (req, res) => {
  const { topic, discipline, campus, recentMessages } = req.body;
  const currentTopic = topic || 'General Peer Discovery';

  // Fallback topical suggestions generator
  const getFallbackSuggestions = (top: string): string[] => {
    const t = top.toLowerCase();
    let pool: string[] = [];

    if (t.includes('math') || t.includes('calculus') || t.includes('diff') || t.includes('integral')) {
      pool = [
        `How are you approaching the problem sets in ${currentTopic}?`,
        'Are you solving practice drills or checking derivations right now?',
        'What formula or theorem in this module is giving you the most headache?',
        'Do you want to compare answers on the latest departmental problem set?',
        'What calculator or CAS software do you use for sanity checks?',
        'How are your professors grading partial points on solutions?',
      ];
    } else if (t.includes('code') || t.includes('cs') || t.includes('dsa') || t.includes('algo') || t.includes('software')) {
      pool = [
        'What programming language or framework are you building your machine problem in?',
        'Are you debugging any weird edge case or runtime segfault today?',
        'How are you approaching time and space complexity for this assignment?',
        'Do you do LeetCode / HackerRank prep or focus mostly on coursework?',
        'What code editor / terminal tools do you swear by for fast coding?',
        'Working on any open-source tools or personal tech projects?',
      ];
    } else if (t.includes('thesis') || t.includes('capstone') || t.includes('research')) {
      pool = [
        `What is the core problem statement of your ${currentTopic}?`,
        'How is your panel review and methodology defense coming along?',
        'Are you doing hardware fabrication, simulation, or software testing?',
        'What datasets or analytical tools are you using for data collection?',
        'Any advice for finding good research papers and IEEE citations?',
      ];
    } else if (t.includes('physic') || t.includes('circuit') || t.includes('hardware') || t.includes('eng')) {
      pool = [
        'How are your laboratory experiments and simulation plates going?',
        'Are you working through free-body diagrams or circuit nodal analysis?',
        'Which engineering subject is the heaviest load for you this quarter?',
        'Do you prefer physical bench testing or LTspice / MATLAB simulations?',
      ];
    } else if (t.includes('campus') || t.includes('quad') || t.includes('vent') || t.includes('chill') || t.includes('stress')) {
      pool = [
        'Which campus are you usually stationed at — main or city campus?',
        'Where is your favorite quiet corner or library nook to study on campus?',
        'How are you holding up with the continuous term pace this week?',
        'Any favorite go-to food or coffee spots around the campus quad?',
        'What is your routine to decompress right after exam week?',
      ];
    } else {
      pool = [
        `What's the main focus of your study session in ${currentTopic}?`,
        'Are you reviewing for an upcoming quiz or finishing a project submission?',
        'What year and program are you currently taking?',
        'What study method works best for you — active recall, flashcards, or practice sets?',
        'How are you dividing up your study hours between heavy subjects?',
        'Any helpful campus or course advice you wish you knew earlier?',
      ];
    }

    // Shuffle pool
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  };

  if (!ai) {
    const suggestions = getFallbackSuggestions(currentTopic);
    return res.json({
      success: true,
      topic: currentTopic,
      suggestions,
      shuffled: true,
      source: 'local_engine',
    });
  }

  try {
    const recentContext = Array.isArray(recentMessages)
      ? recentMessages
          .slice(-4)
          .map((m: any) => `${m.senderHandle || 'Peer'}: ${m.text || ''}`)
          .join('\n')
      : '';

    const prompt = `You are the intelligent topic-aware suggestion engine for "CourseMates", an anonymous real-time study chat for college students.
Context:
- Active Study Topic: "${currentTopic}"
- Academic Discipline: "${discipline || 'Engineering & Technology'}"
- Campus: "${campus || 'Main Campus'}"
- Recent Chat Snippet:
${recentContext || '(No previous messages yet, starting fresh topic)'}

Task:
Generate 4 distinct, engaging, highly contextual discussion starter questions or responses that two students chatting about "${currentTopic}" would genuinely ask each other.
- Make them authentic to college student life (mentioning practical concepts like projects, exams, professors, problem sets, or technical specifics naturally).
- Keep them concise (10-18 words each), conversational, and zero cringe.
- Every time this is invoked, provide creative and varied suggestions.

Return ONLY a JSON array of 4 strings:
["suggestion 1", "suggestion 2", "suggestion 3", "suggestion 4"]`;

    const response = await ai.models.generateContent({
      model: aiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let suggestions: string[] = [];
    try {
      const parsed = JSON.parse(response.text || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        suggestions = parsed.filter((s) => typeof s === 'string' && s.trim().length > 0);
      }
    } catch {
      suggestions = [];
    }

    if (suggestions.length === 0) {
      suggestions = getFallbackSuggestions(currentTopic);
    }

    // Shuffle
    suggestions = suggestions.sort(() => Math.random() - 0.5);

    res.json({
      success: true,
      topic: currentTopic,
      suggestions: suggestions.slice(0, 4),
      shuffled: true,
      source: aiModel,
    });
  } catch (err) {
    console.error('Gemini suggestions error:', err);
    const suggestions = getFallbackSuggestions(currentTopic);
    res.json({
      success: true,
      topic: currentTopic,
      suggestions,
      shuffled: true,
      source: 'fallback',
    });
  }
});

// 4. AI Real-Time Assistant (Explain concept, nudge conversation, or summarize key study takeaways)
app.post('/api/ai/assist', async (req, res) => {
  const { action, chatHistory, query, topic } = req.body;

  if (!ai) {
    if (action === 'summarize' || action === 'explain') {
      return res.status(503).json({ error: 'AI explanations and summaries are unavailable. Configure GEMINI_API_KEY to enable them.' });
    }
    return res.json({ result: 'What are you working on, and which step would you like to discuss together?', source: 'local' });
  }

  try {
    let prompt = '';
    if (action === 'summarize') {
      prompt = `You are the CourseMates Study Assistant. Summarize this anonymous college student peer discussion into 3 concise bullet points with key takeaways or study insights. Keep it supportive and brief.
Chat Log:
${JSON.stringify(chatHistory || [])}`;
    } else if (action === 'explain') {
      prompt = `You are a friendly peer tutor. Explain this engineering, CS, math, science, or university concept concisely and intuitively in 2-3 short paragraphs with an analogy so two students in a study chat can understand it immediately:
Concept/Question: "${query}"`;
    } else {
      prompt = `You are the CourseMates Conversation Wingman. Looking at the recent chat between two anonymous college students:
Chat Context: ${JSON.stringify(chatHistory || [])}
Current Topic: ${topic || 'General'}
Provide 2 friendly, non-intrusive suggestion options for what they could ask or say next to keep the conversation flowing smoothly.`;
    }

    const response = await ai.models.generateContent({
      model: aiModel,
      contents: prompt,
    });

    res.json({ result: response.text });
  } catch (error) {
    console.error('AI assistant request failed.');
    res.status(503).json({
      error: 'The AI assistant is temporarily unavailable. Please try again.',
    });
  }
});

// AI-powered conversation partner used by the Student Chatbot Assistant.
app.post('/api/ai/chatbot', async (req, res) => {
  const session = authenticate(req);
  if (!session) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  if (!groqApiKey && !ai) return res.status(503).json({ error: 'The Student Chatbot Assistant is unavailable until an AI provider key is configured.' });

  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
  const history = Array.isArray(req.body.history)
    ? req.body.history.slice(-6).flatMap((entry: any) => {
        const role = entry?.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof entry?.text === 'string' ? entry.text.trim().slice(0, 1000) : '';
        return text ? [{ role, text }] : [];
      })
    : [];
  if (!message) return res.status(400).json({ error: 'Write a message for the Student Chatbot Assistant.' });

  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim().slice(0, 100) : 'General Peer Discovery';
  const providerName = ai ? 'Gemini' : 'Groq';
  const activeModel = ai ? aiModel : groqModel;
  try {
    const detailedResponseRequested = /\b(?:in detail|detailed|deep dive|step[- ]by[- ]step|comprehensive|thorough|long answer|essay|elaborate|show your work)\b/i.test(message);
    const webSearchRequested = /\b(?:search|look up|latest|current|today|tonight|news|weather|price|score|schedule|online|internet|web)\b/i.test(message);
    const systemInstruction = `You are CourseMates' friendly student chatbot. Talk naturally and follow the user's topic.
For normal questions, answer in 1-2 short sentences and under 60 words. Do not over-explain, show reasoning, use headings, or make lists unless requested.
Only give a longer structured answer when the user explicitly asks for detail, steps, or an essay. Be accurate, honest, helpful, and conversational.`;

    if (groqApiKey && !ai) {
      const contextBudget = 6000;
      let usedCharacters = 0;
      const compactHistory: typeof history = [];
      for (let index = history.length - 1; index >= 0 && usedCharacters < contextBudget; index -= 1) {
        const remaining = contextBudget - usedCharacters;
        const text = history[index].text.slice(0, Math.min(1000, remaining));
        if (!text) continue;
        compactHistory.unshift({ ...history[index], text });
        usedCharacters += text.length;
      }
      const requestGroq = (model: string, includeHistory: boolean) => fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json',
            'Groq-Model-Version': 'latest',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              ...(includeHistory ? compactHistory.map(entry => ({ role: entry.role, content: entry.text })) : []),
              { role: 'user', content: message },
            ],
            temperature: 0.8,
            max_completion_tokens: detailedResponseRequested ? 1200 : 450,
            reasoning_format: 'hidden',
          }),
          signal: AbortSignal.timeout(20000),
        });
      let selectedGroqModel = groqModel;
      let groqResponse = await requestGroq(selectedGroqModel, true);
      if (groqResponse.status === 413) {
        console.warn('Groq rejected the conversation context as too large; retrying with only the latest message.');
        groqResponse = await requestGroq(selectedGroqModel, false);
      }
      if (groqResponse.status === 413 && selectedGroqModel !== 'openai/gpt-oss-20b') {
        selectedGroqModel = 'openai/gpt-oss-20b';
        console.warn(`Groq model ${groqModel} still rejected the minimal request; falling back to ${selectedGroqModel}.`);
        groqResponse = await requestGroq(selectedGroqModel, false);
      }
      if (!groqResponse.ok) {
        const providerError = new Error((await groqResponse.text()).slice(0, 1000)) as Error & { status?: number };
        providerError.status = groqResponse.status;
        throw providerError;
      }
      const data = await groqResponse.json() as any;
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Groq returned an empty response.');
      return res.json({ reply, source: selectedGroqModel });
    }

    const prompt = `Conversation context (use only when relevant):
- Originally selected topic: ${topic}
- Student discipline: ${session.discipline || 'Not specified'}
- Campus: ${session.campus || 'Not specified'}

Recent messages:
${history.map(entry => `${entry.role === 'assistant' ? 'Assistant' : 'Student'}: ${entry.text}`).join('\n') || '(No earlier messages)'}

Student: ${message}
Assistant:`;

    const response = await ai!.models.generateContent({
      model: aiModel,
      contents: prompt,
      config: {
        systemInstruction,
        maxOutputTokens: detailedResponseRequested ? 700 : 220,
        ...(webSearchRequested ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });
    let reply = response.text?.trim() || '';
    if (!reply) throw new Error('Gemini returned an empty response.');
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks.flatMap(chunk => chunk.web?.uri
      ? [{ title: chunk.web.title || 'Source', url: chunk.web.uri }]
      : []);
    const uniqueSources = [...new Map(sources.map(source => [source.url, source])).values()].slice(0, 3);
    if (uniqueSources.length) {
      reply += '\n\nSources:\n' + uniqueSources.map(source => `- ${source.title}: ${source.url}`).join('\n');
    }
    res.json({ reply, source: aiModel });
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${providerName} student chatbot request failed:`, status || 'unknown', detail.slice(0, 500));
    if (status === 400 || status === 401 || status === 403 || /api key|permission|leaked/i.test(detail)) {
      return res.status(503).json({ error: `${providerName} rejected the API key, request, or permissions. Check the provider dashboard.` });
    }
    if (status === 429 || /quota|resource_exhausted|rate limit/i.test(detail)) {
      return res.status(503).json({ error: `The ${providerName} API quota is currently exhausted. Check usage and billing in the provider dashboard.` });
    }
    if (status === 413 || /request.*too large|entity too large/i.test(detail)) {
      return res.status(413).json({ error: `${providerName} rejected the request size even after conversation context was reduced. Try a shorter message.` });
    }
    if (status === 404 || /model.*(?:not found|unavailable|no longer available)|not found.*model/i.test(detail)) {
      return res.status(503).json({ error: `The configured ${providerName} model (${activeModel}) is unavailable to this API key.` });
    }
    if (/fetch failed|network|timeout|timed out/i.test(detail)) {
      return res.status(503).json({ error: `Render could not reach the ${providerName} API. Please try again shortly.` });
    }
    return res.status(503).json({ error: `The Student Chatbot Assistant is temporarily unavailable. Check the Render logs for the ${providerName} error.` });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? 'Request is too large.' : 'Invalid request.' });
});
async function startServer() {
  if (!production) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath, { dotfiles: 'ignore' }));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log('CourseMates running at http://localhost:' + PORT));
}
function shutdown() {
  stopRuntime();
  clearInterval(oauthCleanup);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
startServer().catch(error => { console.error('Unable to start CourseMates:', error.message); process.exit(1); });
