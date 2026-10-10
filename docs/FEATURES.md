# CourseMates feature guide

CourseMates pairs two anonymous students for a private study chat. This guide is
a quick tour of everything the app does, in the order you would meet it.

## The journey at a glance

**Enter → Match → Chat → Play, share, or leave.**

1. You confirm you are 18+ and get an anonymous session. There is no sign-up.
2. You join a queue and are paired with another student.
3. You chat, share media, listen to music together, and play games.
4. Either of you can leave at any time and the room disappears.

## 1. Getting in

- **Anonymous access.** Tick the 18+ box and continue. No email, no school
  verification. A session lasts eight hours.
- **Generated handle.** You get a random name. Reroll it or set your own. Peers
  see only that handle, never your token or email.
- **Terms pages.** Privacy, Terms and Community Guidelines are linked from the
  gate.

## 2. Finding a peer

- **Queue.** Press start and wait. Entries that go quiet for 30 seconds drop out.
- **Optional interests.** Pick a topic to match on shared words (an exact topic
  match ranks highest). Leave it off to match with anyone.
- **Fallback.** If nobody shares your interest, you can choose to chat normally.
- **Chatbot while you wait.** A clearly labelled _simulated_ Student Chatbot
  Assistant keeps you company (Gemini or Groq when available, built-in
  rule-based answers when the provider is exhausted or unconfigured).

## 3. Chatting

- **Live messages** (up to 4,000 characters) over WebSocket, with polling as a
  backup, so a flaky connection still works.
- **Typing indicator**, **reply**, **edit** (text only), **delete** (becomes
  "Message unsent."), and **copy**.
- **Reactions** with six emoji: love, laugh, wow, sad, angry, like.
- **Conversation starters.** Up to three topic-aware prompts per chat, with a
  shuffle button. They expire after 75 seconds.
- **Rejoin after a reload.** A refreshed or backgrounded tab returns to the same
  room.

## 4. Sharing

- **Photos.** Up to 4 per message (JPEG, PNG, WebP, GIF). Paste from the
  clipboard or pick a file.
- **Voice messages.** One per send, up to 3 minutes.
- **Safety lock.** Photos and voice unlock **90 seconds** after matching, with a
  visible countdown. Text and music are not locked.
- **Music snippets.** Search YouTube or use the catalog, drag a 15–30 second
  window, preview it, add a note, and send a vinyl-style card.
- **Shared music player.** Both people hear the same track, queue (up to 50
  songs) and position.

## 5. Games

Open **Games** in the chat header to invite your peer. One game at a time per
chat (UNO can run as its own table).

| Game                | In short                                                     |
| ------------------- | ------------------------------------------------------------ |
| UNO                 | Full card game with an arena and challenges                  |
| Tic-Tac-Toe         | Classic 3×3                                                  |
| Rock Paper Scissors | Multi-round match                                            |
| Connect Four        | Drop discs, link four                                        |
| Chess               | Full rules, check and promotion                              |
| Trivia              | Question rounds with scores                                  |
| Would You Rather    | Both pick in secret, then answers reveal                     |
| **Draw & Guess**    | Six turns, 60 s each, 1,100 prompts, mouse/touch/pen drawing |

Every game supports invite, accept, decline, minimize and resume, leaving (which
posts a notice in the chat), and rematches. The server keeps all state, and
hidden information, such as UNO hands, the Draw & Guess word and unrevealed Would
You Rather choices, is never sent to the other player.

### Draw & Guess details

Pick a category and difficulty, then take turns. The drawer chooses one of three
secret words, draws for 60 seconds, and the other player guesses. A correct guess
gives both players 100 points, and the guesser earns up to 60 more for speed.
Tools: ten colors, three brush sizes, eraser, undo and clear.

## 6. Look and feel

- **Light and dark mode** with an animated reveal.
- **Fifteen chat color themes** (Crimson, Ocean, Forest, Violet and more).
- **Ambient aurora** that follows the music. Spider-Man and Spider-Verse tracks
  switch it to a web background.
- **Sound toggle**, **fullscreen**, and layouts for phone and desktop.
- **Accessibility:** reduced-motion support, keyboard and focus handling, and
  automated axe-core checks.

## 7. Safety and moderation

- **Report or block** a peer from the chat header.
- **Text filter** blocks messages that break the community rules, including music
  titles and notes.
- **Privacy by design.** Messages and media live only in memory, are never
  logged, and vanish when the room ends or the server restarts. Reports store a
  hashed actor and an IP, never message text.
- **Admin dashboard** (`/api/admin`) lets moderators review reports, ban users
  and see live metrics. It is protected by an admin login.

## 8. AI helpers (optional)

| Helper                | What it does                                       |
| --------------------- | -------------------------------------------------- |
| Conversation starters | Topic-aware icebreakers, with built-in fallbacks   |
| Assistant             | Explain a concept or summarize the chat on request |
| Student Chatbot       | Simulated partner while you wait for a match       |

Gemini is used first, Groq if Gemini is absent. Without a key, starters fall
back to a built-in list and the other helpers report that they are unavailable.

## 9. Behind the scenes

- **Stack:** React + Vite front end, Express and WebSocket server, all runtime
  state in one Node process.
- **Python orchestrator** (optional): a shadow service that observes matching for
  comparison only. It never changes what users see.
- **C++ native module** (optional): a faster content filter used through Python.
- **Ops:** Docker images, a CI pipeline, health endpoints and a runbook in
  `docs/operations.md`.

For developer details, see `CLAUDE.md`.
