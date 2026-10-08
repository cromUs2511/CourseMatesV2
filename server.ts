import express from 'express';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { attachRuntime, authenticate, issueSession, publicSession, cookie } from './runtime';
import {
  DEFAULT_MUSIC_DIRECTORY,
  extractYouTubeVideoId,
  parseTrackDuration,
} from './src/data/musicDirectory';
import { CHAT_SEND_BODY_LIMIT } from './src/data/chatImages';
import { createPythonOrchestratorClient, pythonOrchestratorConfig } from './pythonOrchestrator';
import { SafetyStore, moderateText } from './safety';
import { ModerationDb, resolveModerationDbPath } from './moderationDb';
import {
  constantTimeEqual,
  logEvent,
  providerGuard,
  requireObjectBody,
  securityMiddleware,
  validateAiInput,
  validateProductionConfig,
} from './serverSecurity';

if (process.env.LOAD_LOCAL_ENV !== 'false')
  dotenv.config({
    path: ['.env.groq.local', '.env.gemini.local', '.env.local', '.env'],
    quiet: true,
  });
const app = express();
const pythonOrchestrator = createPythonOrchestratorClient(pythonOrchestratorConfig());
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
validateProductionConfig(process.env, production && process.env.NODE_ENV !== 'test');
const moderationSecret = process.env.MODERATION_SECRET || crypto.randomBytes(32).toString('hex');
const safety = new SafetyStore({
  secret: moderationSecret,
  ...(process.env.DATA_DIR ? { path: path.resolve(process.env.DATA_DIR, 'moderation.json') } : {}),
});
// Persistent review database: MODERATION_DB_PATH wins, else DATA_DIR/moderation.db,
// else memory-only (development/tests). Production must set DATA_DIR.
const moderationDbPath = resolveModerationDbPath(process.env);
const moderationDb = new ModerationDb(moderationDbPath);
const origin = process.env.APP_URL?.replace(/\/$/, '');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
app.set('trust proxy', proxyHops);
const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || '';
if (!youtubeApiKey) {
  logEvent('youtube_search_disabled');
}
const allowAnonymousAccess = process.env.ALLOW_ANONYMOUS_ACCESS !== 'false';
app.disable('x-powered-by');
app.use(
  securityMiddleware({
    origin,
    production,
    adminToken: process.env.ADMIN_TOKEN,
    testRateScale: process.env.NODE_ENV === 'test' ? 100 : 1,
  }),
);
app.post(
  '/api/chat/send',
  (req, res, next) => {
    if (!authenticate(req))
      return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    next();
  },
  express.json({ limit: CHAT_SEND_BODY_LIMIT }),
);
app.use(express.json({ limit: '64kb' }));
app.use('/api', requireObjectBody());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const server = http.createServer(app);
const stopRuntime = attachRuntime(app, server, {
  safety,
  moderationDb,
  origin,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD,
  adminToken: process.env.ADMIN_TOKEN,
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.Gemini_AI?.trim() || '';
const groqApiKey = process.env.GROQ_API_KEY?.trim() || '';
const groqModel = process.env.GROQ_MODEL?.trim() || 'groq/compound';
let ai: GoogleGenAI | null = null;
if (geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY') {
  ai = new GoogleGenAI({ apiKey: geminiApiKey, httpOptions: { timeout: 15000 } });
}
const configuredAiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
const aiModel = configuredAiModel === 'gemini-2.5-flash' ? 'gemini-3.6-flash' : configuredAiModel;
function sessionCookie(req: express.Request, res: express.Response, token: string) {
  const secure = (process.env.APP_URL || req.protocol + '://' + req.get('host')).startsWith(
    'https:',
  );
  res.cookie('cm_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  });
}
app.get('/api/auth/config', (_req, res) => res.json({ allowAnonymousAccess }));
app.get('/api/public-config', (_req, res) =>
  res.json({ supportEmail: process.env.SUPPORT_EMAIL || '' }),
);
app.post('/api/auth/anonymous', (req, res) => {
  if (!allowAnonymousAccess)
    return res.status(403).json({ error: 'Anonymous access is disabled.' });
  if (req.body.acceptedTerms !== true)
    return res
      .status(400)
      .json({ error: 'Confirm that you are 18 or older and accept the community terms.' });
  try {
    const existing = authenticate(req);
    if (existing) return res.json({ success: true, session: publicSession(existing) });
    const deviceCookie = cookie(req, 'cm_device') || '';
    const [givenId, signature] = deviceCookie.split('.');
    const sign = (id: string) =>
      crypto.createHmac('sha256', moderationSecret).update(id).digest('hex');
    const deviceId =
      givenId &&
      /^[a-f0-9]{64}$/.test(givenId) &&
      signature &&
      constantTimeEqual(signature, sign(givenId))
        ? givenId
        : crypto.randomBytes(32).toString('hex');
    const actor = safety.actor(deviceId);
    if (safety.isBanned(actor, req.ip))
      return res.status(403).json({
        error: 'Access to this community has been restricted. Contact support to appeal.',
      });
    const session = issueSession('', {}, false, actor, req.ip);
    res.cookie('cm_device', deviceId + '.' + sign(deviceId), {
      httpOnly: true,
      sameSite: 'strict',
      secure: origin?.startsWith('https:') || req.secure,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    sessionCookie(req, res, session.token);
    res.json({ success: true, session: publicSession(session) });
  } catch {
    res
      .status(503)
      .json({ error: 'Anonymous access is temporarily unavailable. Please try again later.' });
  }
});
app.post(['/api/auth/school-email', '/api/auth/verify-school'], (_req, res) =>
  res
    .status(410)
    .json({ error: 'Use anonymous access. CourseMates does not verify student identities.' }),
);

const musicDirectory = DEFAULT_MUSIC_DIRECTORY.map((track) => ({ ...track }));
app.get('/api/music/directory', (_req, res) =>
  res.json({ tracks: musicDirectory, total: musicDirectory.length }),
);
app.get('/api/music/search', providerGuard(4), async (req, res) => {
  if (!authenticate(req)) return res.status(401).json({ error: 'Please sign in first.' });
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (query.length < 2) return res.status(400).json({ error: 'Search for at least 2 characters.' });
  if (!youtubeApiKey)
    return res
      .status(503)
      .json({ error: 'YouTube search is unavailable because YOUTUBE_API_KEY is missing.' });
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '12',
      videoCategoryId: '10',
      key: youtubeApiKey,
    });
    const response = await fetch('https://www.googleapis.com/youtube/v3/search?' + params, {
      signal: AbortSignal.timeout(10000),
    });
    const data = (await response.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          channelTitle?: string;
          thumbnails?: { medium?: { url?: string } };
        };
      }>;
    };
    if (!response.ok)
      return res.status(502).json({ error: 'YouTube search is temporarily unavailable.' });
    const ids = (data.items || [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id));
    const details = new Map<string, { duration?: string; live?: string; embeddable?: boolean }>();
    if (ids.length) {
      const detailParams = new URLSearchParams({
        part: 'contentDetails,snippet,status',
        id: ids.join(','),
        key: youtubeApiKey,
      });
      const detailResponse = await fetch(
        'https://www.googleapis.com/youtube/v3/videos?' + detailParams,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!detailResponse.ok)
        return res
          .status(502)
          .json({ error: 'YouTube track details are temporarily unavailable.' });
      const detailData = (await detailResponse.json()) as {
        items?: Array<{
          id?: string;
          contentDetails?: { duration?: string };
          snippet?: { liveBroadcastContent?: string };
          status?: { embeddable?: boolean };
        }>;
      };
      for (const item of detailData.items || [])
        if (item.id)
          details.set(item.id, {
            duration: item.contentDetails?.duration,
            live: item.snippet?.liveBroadcastContent,
            embeddable: item.status?.embeddable,
          });
    }
    const tracks = (data.items || []).flatMap((item) => {
      const videoId = item.id?.videoId;
      const detail = videoId ? details.get(videoId) : undefined;
      if (
        !videoId ||
        !item.snippet?.title ||
        !detail ||
        detail.live === 'live' ||
        detail.live === 'upcoming' ||
        detail.embeddable === false ||
        !parseTrackDuration(detail.duration)
      )
        return [];
      return [
        {
          id: 'youtube-search-' + videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle || 'YouTube',
          youtubeUrl: 'https://www.youtube.com/watch?v=' + videoId,
          youtubeVideoId: videoId,
          category: 'custom' as const,
          thumbnail: item.snippet.thumbnails?.medium?.url,
          duration: detail.duration,
        },
      ];
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
  const track = {
    id: crypto.randomUUID(),
    title:
      typeof req.body.title === 'string' ? req.body.title.slice(0, 160) : 'Community study track',
    artist: typeof req.body.artist === 'string' ? req.body.artist.slice(0, 100) : 'Community',
    category: 'custom' as const,
    youtubeUrl: 'https://www.youtube.com/watch?v=' + videoId,
    youtubeVideoId: videoId,
  };
  if (!moderateText(track.title + ' ' + track.artist).allowed)
    return res.status(400).json({ error: 'Choose a track that follows the community rules.' });
  musicDirectory.unshift(track);
  if (musicDirectory.length > 100) musicDirectory.pop();
  res.json({ success: true, track });
});
const DEFAULT_ICEBREAKERS: Record<string, string[]> = {
  academics: [
    "What's your toughest subject this term and what's making it tricky?",
    'Do you prefer morning 7:30 AM lectures or late afternoon laboratory blocks?',
    'How are you managing the fast-paced term schedule?',
    "What's one study hack or YouTube channel that saved your grade?",
    'Are you working on any cool course projects or capstone ideas right now?',
  ],
  campus: [
    "What's the best hidden food spot or coffee haven near your campus?",
    'Do you prefer studying at the library, student lounge, or off-campus cafes?',
    'How is the commute to campus treating you this week?',
    "What's your go-to comfort meal after a grueling 3-hour midterm exam?",
  ],
  career: [
    'What kind of industry or field are you hoping to enter after graduation?',
    'Have you started looking at OJT / internship opportunities yet?',
    'What tech stack or engineering software tools are you currently trying to learn?',
  ],
  stress_relief: [
    'On a scale of 1-10, how is your term stress level right now, and what helps you decompress?',
    'What video games, anime, music, or hobbies are currently keeping you sane?',
    'Take a deep breath! What is one small win you had this past week?',
  ],
};

app.use(
  '/api/ai',
  (req, res, next) => {
    try {
      validateAiInput(req.body);
      next();
    } catch {
      res.status(400).json({ error: 'Invalid AI input or conversation context.' });
    }
  },
  providerGuard(),
);

app.post('/api/ai/icebreakers', async (req, res) => {
  const { topic, discipline, campus } = req.body;

  if (!ai) {
    const categoryList =
      DEFAULT_ICEBREAKERS[topic as keyof typeof DEFAULT_ICEBREAKERS] ??
      DEFAULT_ICEBREAKERS.academics ??
      [];
    void pythonOrchestrator.observeIcebreakers({
      topic: typeof topic === 'string' ? topic : '',
      discipline: typeof discipline === 'string' ? discipline : '',
      campus: typeof campus === 'string' ? campus : '',
    });
    return res.json({
      icebreakers: categoryList.slice(0, 4),
      topicSuggestions: [
        'Compare study workflows',
        'Share term survival tips',
        'Discuss dream capstone projects',
        'Recommend campus study spots',
      ],
      encouragingNote: 'Anonymous peer connected. Pick an icebreaker to start the conversation.',
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
    const categoryList =
      DEFAULT_ICEBREAKERS[topic as keyof typeof DEFAULT_ICEBREAKERS] ??
      DEFAULT_ICEBREAKERS.academics ??
      [];
    void pythonOrchestrator.observeIcebreakers({
      topic: typeof topic === 'string' ? topic : '',
      discipline: typeof discipline === 'string' ? discipline : '',
      campus: typeof campus === 'string' ? campus : '',
    });
    res.json({
      icebreakers: categoryList.slice(0, 4),
      topicSuggestions: [
        'Compare study workflows',
        'Share term survival tips',
        'Discuss dream capstone projects',
        'Recommend campus study spots',
      ],
      encouragingNote: 'Verified peer connected! Break the ice with one of the prompts below.',
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
    let pool: string[];

    if (
      t.includes('math') ||
      t.includes('calculus') ||
      t.includes('diff') ||
      t.includes('integral')
    ) {
      pool = [
        `How are you approaching the problem sets in ${currentTopic}?`,
        'Are you solving practice drills or checking derivations right now?',
        'What formula or theorem in this module is giving you the most headache?',
        'Do you want to compare answers on the latest departmental problem set?',
        'What calculator or CAS software do you use for sanity checks?',
        'How are your professors grading partial points on solutions?',
      ];
    } else if (
      t.includes('code') ||
      t.includes('cs') ||
      t.includes('dsa') ||
      t.includes('algo') ||
      t.includes('software')
    ) {
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
    } else if (
      t.includes('physic') ||
      t.includes('circuit') ||
      t.includes('hardware') ||
      t.includes('eng')
    ) {
      pool = [
        'How are your laboratory experiments and simulation plates going?',
        'Are you working through free-body diagrams or circuit nodal analysis?',
        'Which engineering subject is the heaviest load for you this quarter?',
        'Do you prefer physical bench testing or LTspice / MATLAB simulations?',
      ];
    } else if (
      t.includes('campus') ||
      t.includes('quad') ||
      t.includes('vent') ||
      t.includes('chill') ||
      t.includes('stress')
    ) {
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
      return res.status(503).json({
        error:
          'AI explanations and summaries are unavailable. Configure GEMINI_API_KEY to enable them.',
      });
    }
    return res.json({
      result: 'What are you working on, and which step would you like to discuss together?',
      source: 'local',
    });
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
  if (!session)
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  if (!groqApiKey && !ai)
    return res.status(503).json({
      error: 'The Student Chatbot Assistant is unavailable until an AI provider key is configured.',
    });

  const message =
    typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
  const history: Array<{ role: 'assistant' | 'user'; text: string }> = Array.isArray(
    req.body.history,
  )
    ? req.body.history.slice(-6).flatMap((entry: any) => {
        const role = entry?.role === 'assistant' ? 'assistant' : 'user';
        const text = typeof entry?.text === 'string' ? entry.text.trim().slice(0, 1000) : '';
        return text ? [{ role, text }] : [];
      })
    : [];
  if (!message)
    return res.status(400).json({ error: 'Write a message for the Student Chatbot Assistant.' });

  const topic =
    typeof req.body.topic === 'string'
      ? req.body.topic.trim().slice(0, 100)
      : 'General Peer Discovery';
  const providerName = ai ? 'Gemini' : 'Groq';
  const activeModel = ai ? aiModel : groqModel;
  try {
    const detailedResponseRequested =
      /\b(?:in detail|detailed|deep dive|step[- ]by[- ]step|comprehensive|thorough|long answer|essay|elaborate|show your work)\b/i.test(
        message,
      );
    const webSearchRequested =
      /\b(?:search|look up|latest|current|today|tonight|news|weather|price|score|schedule|online|internet|web)\b/i.test(
        message,
      );
    const systemInstruction = `You are CourseMates' friendly student chatbot. Talk naturally and follow the user's topic.
For normal questions, answer in 1-2 short sentences and under 60 words. Do not over-explain, show reasoning, use headings, or make lists unless requested.
Only give a longer structured answer when the user explicitly asks for detail, steps, or an essay. Always finish your sentence. Be accurate, honest, helpful, and conversational.`;

    if (groqApiKey && !ai) {
      const contextBudget = 6000;
      let usedCharacters = 0;
      const compactHistory: typeof history = [];
      for (
        let index = history.length - 1;
        index >= 0 && usedCharacters < contextBudget;
        index -= 1
      ) {
        const remaining = contextBudget - usedCharacters;
        const turn = history[index];
        if (!turn) continue;
        const text = turn.text.slice(0, Math.min(1000, remaining));
        if (!text) continue;
        compactHistory.unshift({ ...turn, text });
        usedCharacters += text.length;
      }
      const requestGroq = (model: string, includeHistory: boolean) =>
        fetch('https://api.groq.com/openai/v1/chat/completions', {
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
              ...(includeHistory
                ? compactHistory.map((entry) => ({ role: entry.role, content: entry.text }))
                : []),
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
        console.warn(
          'Groq rejected the conversation context as too large; retrying with only the latest message.',
        );
        groqResponse = await requestGroq(selectedGroqModel, false);
      }
      if (groqResponse.status === 413 && selectedGroqModel !== 'openai/gpt-oss-20b') {
        selectedGroqModel = 'openai/gpt-oss-20b';
        console.warn(
          `Groq model ${groqModel} still rejected the minimal request; falling back to ${selectedGroqModel}.`,
        );
        groqResponse = await requestGroq(selectedGroqModel, false);
      }
      if (!groqResponse.ok) {
        const providerError = new Error((await groqResponse.text()).slice(0, 1000)) as Error & {
          status?: number;
        };
        providerError.status = groqResponse.status;
        throw providerError;
      }
      const data = (await groqResponse.json()) as any;
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Groq returned an empty response.');
      return res.json({ reply, source: selectedGroqModel });
    }

    const prompt = `Conversation context (use only when relevant):
- Originally selected topic: ${topic}
- Student discipline: ${session.discipline || 'Not specified'}
- Campus: ${session.campus || 'Not specified'}

Recent messages:
${history.map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'Student'}: ${entry.text}`).join('\n') || '(No earlier messages)'}

Student: ${message}
Assistant:`;

    const response = await ai!.models.generateContent({
      model: aiModel,
      contents: prompt,
      config: {
        systemInstruction,
        // Gemini's output budget includes hidden thinking tokens. Keep thinking low
        // and leave enough headroom so a short visible answer is not cut in half.
        thinkingConfig: {
          thinkingLevel: detailedResponseRequested ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
        },
        maxOutputTokens: detailedResponseRequested ? 2048 : 1024,
        ...(webSearchRequested ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });
    let reply = response.text?.trim() || '';
    if (!reply) throw new Error('Gemini returned an empty response.');
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks.flatMap((chunk) =>
      chunk.web?.uri ? [{ title: chunk.web.title || 'Source', url: chunk.web.uri }] : [],
    );
    const uniqueSources = [
      ...new Map(sources.map((source) => [source.url, source])).values(),
    ].slice(0, 3);
    if (uniqueSources.length) {
      reply +=
        '\n\nSources:\n' +
        uniqueSources.map((source) => `- ${source.title}: ${source.url}`).join('\n');
    }
    res.json({ reply, source: aiModel });
  } catch (error) {
    const status =
      typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    const detail = error instanceof Error ? error.message : String(error);
    logEvent('chatbot_provider_failed', { status });
    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      /api key|permission|leaked/i.test(detail)
    ) {
      return res.status(503).json({
        error: `${providerName} rejected the API key, request, or permissions. Check the provider dashboard.`,
      });
    }
    if (status === 429 || /quota|resource_exhausted|rate limit/i.test(detail)) {
      return res.status(503).json({
        error: `The ${providerName} API quota is currently exhausted. Check usage and billing in the provider dashboard.`,
      });
    }
    if (status === 413 || /request.*too large|entity too large/i.test(detail)) {
      return res.status(413).json({
        error: `${providerName} rejected the request size even after conversation context was reduced. Try a shorter message.`,
      });
    }
    if (
      status === 404 ||
      /model.*(?:not found|unavailable|no longer available)|not found.*model/i.test(detail)
    ) {
      return res.status(503).json({
        error: `The configured ${providerName} model (${activeModel}) is unavailable to this API key.`,
      });
    }
    if (/fetch failed|network|timeout|timed out/i.test(detail)) {
      return res.status(503).json({
        error: `Render could not reach the ${providerName} API. Please try again shortly.`,
      });
    }
    return res.status(503).json({
      error: `The Student Chatbot Assistant is temporarily unavailable. Check the Render logs for the ${providerName} error.`,
    });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({
    error:
      status === 413
        ? 'Request is too large.'
        : status === 400
          ? 'Invalid request.'
          : 'The service is temporarily unavailable.',
  });
});
async function startServer() {
  const policyPath = production ? path.resolve('dist') : path.resolve('public');
  app.get(['/terms', '/privacy', '/community'], (req, res) =>
    res.sendFile(path.join(policyPath, req.path.slice(1) + '.html')),
  );
  if (!production) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath, { dotfiles: 'ignore' }));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => logEvent('server_ready'));
}
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  logEvent('server_draining');
  stopRuntime();
  try {
    moderationDb.close();
  } catch {
    /* Best effort on shutdown. */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
startServer().catch(() => {
  logEvent('startup_failed');
  process.exit(1);
});
