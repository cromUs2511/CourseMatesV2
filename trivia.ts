import crypto from 'node:crypto';
import type { TriviaState, TriviaAction, TriviaQuestion, TriviaCategory } from './src/data/peerGames';

const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  // General Knowledge
  { id: 'gk1', question: 'What is the capital of France?', options: ['London', 'Paris', 'Berlin', 'Madrid'], correctIndex: 1, category: 'general' },
  { id: 'gk2', question: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correctIndex: 1, category: 'general' },
  { id: 'gk3', question: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3, category: 'general' },
  { id: 'gk4', question: 'How many continents are there?', options: ['5', '6', '7', '8'], correctIndex: 2, category: 'general' },
  { id: 'gk5', question: 'What is the currency of Japan?', options: ['Yuan', 'Won', 'Yen', 'Ringgit'], correctIndex: 2, category: 'general' },
  { id: 'gk6', question: 'Which country gifted the Statue of Liberty to the USA?', options: ['France', 'UK', 'Germany', 'Italy'], correctIndex: 0, category: 'general' },
  { id: 'gk7', question: 'What is the hardest natural substance on Earth?', options: ['Gold', 'Iron', 'Diamond', 'Platinum'], correctIndex: 2, category: 'general' },
  { id: 'gk8', question: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correctIndex: 1, category: 'general' },

  // Science
  { id: 'sci1', question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correctIndex: 2, category: 'science' },
  { id: 'sci2', question: 'What planet is closest to the Sun?', options: ['Venus', 'Mercury', 'Earth', 'Mars'], correctIndex: 1, category: 'science' },
  { id: 'sci3', question: 'What is the speed of light?', options: ['300,000 km/s', '150,000 km/s', '1,000,000 km/s', '500,000 km/s'], correctIndex: 0, category: 'science' },
  { id: 'sci4', question: 'How many bones are in an adult human body?', options: ['196', '206', '216', '226'], correctIndex: 1, category: 'science' },
  { id: 'sci5', question: 'What gas do plants absorb from the atmosphere?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], correctIndex: 2, category: 'science' },
  { id: 'sci6', question: 'What is the center of an atom called?', options: ['Nucleus', 'Electron', 'Proton', 'Neutron'], correctIndex: 0, category: 'science' },
  { id: 'sci7', question: 'Which element has atomic number 1?', options: ['Helium', 'Hydrogen', 'Lithium', 'Oxygen'], correctIndex: 1, category: 'science' },
  { id: 'sci8', question: 'What is the powerhouse of the cell?', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi apparatus'], correctIndex: 2, category: 'science' },

  // Technology
  { id: 'tech1', question: 'What does CPU stand for?', options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Unit', 'Core Processing Unit'], correctIndex: 0, category: 'technology' },
  { id: 'tech2', question: 'Who founded Microsoft?', options: ['Steve Jobs', 'Bill Gates', 'Mark Zuckerberg', 'Larry Page'], correctIndex: 1, category: 'technology' },
  { id: 'tech3', question: 'What does HTTP stand for?', options: ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'Hyper Transfer Text Protocol', 'High Text Transfer Protocol'], correctIndex: 0, category: 'technology' },
  { id: 'tech4', question: 'What year was the first iPhone released?', options: ['2005', '2007', '2009', '2010'], correctIndex: 1, category: 'technology' },
  { id: 'tech5', question: 'What does RAM stand for?', options: ['Random Access Memory', 'Read Access Memory', 'Rapid Access Memory', 'Real Access Memory'], correctIndex: 0, category: 'technology' },
  { id: 'tech6', question: 'Which company developed the Linux kernel?', options: ['Microsoft', 'Apple', 'Red Hat', 'Linus Torvalds (individual)'], correctIndex: 3, category: 'technology' },
  { id: 'tech7', question: 'What is the most popular programming language (2024)?', options: ['Python', 'JavaScript', 'Java', 'C++'], correctIndex: 1, category: 'technology' },
  { id: 'tech8', question: 'What does GPU stand for?', options: ['Graphics Processing Unit', 'General Purpose Unit', 'Graphical Program Unit', 'Global Processing Unit'], correctIndex: 0, category: 'technology' },

  // Gaming
  { id: 'gaming1', question: 'Which game features a character named Mario?', options: ['Sonic', 'Zelda', 'Super Mario Bros', 'Metroid'], correctIndex: 2, category: 'gaming' },
  { id: 'gaming2', question: 'What year was Minecraft released?', options: ['2009', '2011', '2013', '2015'], correctIndex: 1, category: 'gaming' },
  { id: 'gaming3', question: 'Which company makes the PlayStation?', options: ['Microsoft', 'Nintendo', 'Sony', 'Sega'], correctIndex: 2, category: 'gaming' },
  { id: 'gaming4', question: 'What is the best-selling video game of all time?', options: ['Tetris', 'Minecraft', 'GTA V', 'Wii Sports'], correctIndex: 1, category: 'gaming' },
  { id: 'gaming5', question: 'In which game do you play as Link?', options: ['Mario', 'Zelda', 'Metroid', 'Kirby'], correctIndex: 1, category: 'gaming' },
  { id: 'gaming6', question: 'What does NPC stand for?', options: ['Non-Player Character', 'New Player Character', 'Network Player Connection', 'Next Player Choice'], correctIndex: 0, category: 'gaming' },
  { id: 'gaming7', question: 'Which game popularized the Battle Royale genre?', options: ['Fortnite', 'PUBG', 'Apex Legends', 'Call of Duty Warzone'], correctIndex: 1, category: 'gaming' },
  { id: 'gaming8', question: 'What is the name of the main character in God of War?', options: ['Zeus', 'Kratos', 'Thor', 'Odin'], correctIndex: 1, category: 'gaming' },

  // Movies
  { id: 'movies1', question: 'Who directed The Dark Knight?', options: ['Steven Spielberg', 'Christopher Nolan', 'Martin Scorsese', 'James Cameron'], correctIndex: 1, category: 'movies' },
  { id: 'movies2', question: 'What movie won Best Picture at the 2020 Oscars?', options: ['1917', 'Parasite', 'Joker', 'Once Upon a Time in Hollywood'], correctIndex: 1, category: 'movies' },
  { id: 'movies3', question: 'In which movie does Tom Hanks play a man stranded on an island?', options: ['Cast Away', 'The Terminal', 'Saving Private Ryan', 'Forrest Gump'], correctIndex: 0, category: 'movies' },
  { id: 'movies4', question: 'What is the highest-grossing film of all time?', options: ['Avatar', 'Avengers: Endgame', 'Titanic', 'Star Wars: The Force Awakens'], correctIndex: 0, category: 'movies' },
  { id: 'movies5', question: 'Who played Iron Man in the MCU?', options: ['Chris Evans', 'Chris Hemsworth', 'Robert Downey Jr.', 'Mark Ruffalo'], correctIndex: 2, category: 'movies' },
  { id: 'movies6', question: 'Which studio produced Toy Story?', options: ['DreamWorks', 'Pixar', 'Disney Animation', 'Illumination'], correctIndex: 1, category: 'movies' },
  { id: 'movies7', question: 'What year was The Matrix released?', options: ['1997', '1999', '2001', '2003'], correctIndex: 1, category: 'movies' },
  { id: 'movies8', question: 'Who directed Pulp Fiction?', options: ['Quentin Tarantino', 'Robert Rodriguez', 'Guy Ritchie', 'David Fincher'], correctIndex: 0, category: 'movies' },

  // Music
  { id: 'music1', question: 'Who is known as the King of Pop?', options: ['Elvis Presley', 'Michael Jackson', 'Prince', 'Freddie Mercury'], correctIndex: 1, category: 'music' },
  { id: 'music2', question: 'Which band wrote "Bohemian Rhapsody"?', options: ['The Beatles', 'Queen', 'Led Zeppelin', 'Pink Floyd'], correctIndex: 1, category: 'music' },
  { id: 'music3', question: 'What instrument has 88 keys?', options: ['Guitar', 'Violin', 'Piano', 'Drums'], correctIndex: 2, category: 'music' },
  { id: 'music4', question: 'Who sang "Rolling in the Deep"?', options: ['Adele', 'Beyoncé', 'Taylor Swift', 'Rihanna'], correctIndex: 0, category: 'music' },
  { id: 'music5', question: 'How many strings does a standard guitar have?', options: ['4', '5', '6', '7'], correctIndex: 2, category: 'music' },
  { id: 'music6', question: 'What genre is Mozart associated with?', options: ['Rock', 'Jazz', 'Classical', 'Blues'], correctIndex: 2, category: 'music' },
  { id: 'music7', question: 'Which band had a hit with "Sweet Child o Mine"?', options: ['Guns N Roses', 'Metallica', 'Bon Jovi', 'AC/DC'], correctIndex: 0, category: 'music' },
  { id: 'music8', question: 'What does BPM stand for in music?', options: ['Beats Per Minute', 'Bass Per Measure', 'Basic Pulse Meter', 'Beats Per Measure'], correctIndex: 0, category: 'music' },

  // History
  { id: 'hist1', question: 'In which year did World War II end?', options: ['1943', '1945', '1947', '1950'], correctIndex: 1, category: 'history' },
  { id: 'hist2', question: 'Who was the first person to walk on the Moon?', options: ['Buzz Aldrin', 'Neil Armstrong', 'Yuri Gagarin', 'Michael Collins'], correctIndex: 1, category: 'history' },
  { id: 'hist3', question: 'Which ancient civilization built the pyramids of Giza?', options: ['Romans', 'Greeks', 'Egyptians', 'Mayans'], correctIndex: 2, category: 'history' },
  { id: 'hist4', question: 'What year did the Titanic sink?', options: ['1910', '1912', '1914', '1916'], correctIndex: 1, category: 'history' },
  { id: 'hist5', question: 'Who was the first President of the United States?', options: ['Thomas Jefferson', 'John Adams', 'George Washington', 'Benjamin Franklin'], correctIndex: 2, category: 'history' },
  { id: 'hist6', question: 'The Berlin Wall fell in which year?', options: ['1987', '1989', '1991', '1993'], correctIndex: 1, category: 'history' },
  { id: 'hist7', question: 'Which war was fought between 1914-1918?', options: ['World War II', 'World War I', 'Cold War', 'Korean War'], correctIndex: 1, category: 'history' },
  { id: 'hist8', question: 'Who painted the Mona Lisa?', options: ['Vincent van Gogh', 'Pablo Picasso', 'Leonardo da Vinci', 'Michelangelo'], correctIndex: 2, category: 'history' },
];

function getQuestions(category: TriviaCategory, count: number = 10): TriviaQuestion[] {
  let pool: TriviaQuestion[];
  if (category === 'random') {
    pool = TRIVIA_QUESTIONS;
  } else {
    pool = TRIVIA_QUESTIONS.filter((q) => q.category === category);
    if (pool.length < count) {
      pool = [...pool, ...TRIVIA_QUESTIONS.filter((q) => q.category === 'general')];
    }
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export class PeerTrivia {
  private state: TriviaState = { revision: 0, invitation: null, game: null };
  private pendingCategory: TriviaCategory = 'general';

  snapshot(now = Date.now()): TriviaState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  act(actor: string, peers: { id: string; handle: string }[], action: TriviaAction): void {
    if (peers.length !== 2 || !peers.some((peer) => peer.id === actor))
      throw new Error('This game is for the two current chat participants.');
    this.snapshot();
    const state = this.state;

    if (action.action === 'invite') {
      if (state.game) throw new Error('Open the current game to play or request a rematch.');
      if (state.invitation) throw new Error('Answer the pending invitation first.');
      state.invitation = {
        id: crypto.randomUUID(),
        fromId: actor,
        fromHandle: peers.find((peer) => peer.id === actor)!.handle,
        expiresAt: Date.now() + 90000,
      };
      this.pendingCategory = action.category;
    } else if (action.action === 'respond') {
      const invitation = state.invitation;
      if (!invitation || invitation.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (action.accept && invitation.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept) {
        const ordered = [...peers].sort((a) => a.id === invitation.fromId ? -1 : 1);
        const questions = getQuestions(this.pendingCategory);
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer) => ({ ...peer })),
          questions,
          currentQuestionIndex: 0,
          answers: {},
          scores: { [ordered[0]!.id]: 0, [ordered[1]!.id]: 0 },
          timerEndsAt: Date.now() + 30000,
          phase: 'answering',
          result: null,
          category: this.pendingCategory,
          rematch: [],
        };
      }
      state.invitation = null;
    } else {
      const game = state.game!;
      if (!game || game.id !== action.gameId || game.round !== action.round)
        throw new Error('That round is no longer available.');

      if (action.action === 'rematch') {
        if (!game.result) throw new Error('Finish this round first.');
        if (game.rematch.includes(actor)) return;
        game.rematch.push(actor);
        if (game.rematch.length === 2) {
          game.round++;
          const questions = getQuestions(game.category);
          game.questions = questions;
          game.currentQuestionIndex = 0;
          game.answers = {};
          game.scores = { [game.players[0]!.id]: 0, [game.players[1]!.id]: 0 };
          game.timerEndsAt = Date.now() + 30000;
          game.phase = 'answering';
          game.result = null;
          game.rematch = [];
        }
      } else if (action.action === 'answer') {
        if (game.phase !== 'answering') throw new Error('Not time to answer.');
        if (game.answers[actor]) throw new Error('You have already answered.');

        game.answers[actor] = { answerIndex: action.answerIndex, timestamp: Date.now() };

        if (Object.keys(game.answers).length === 2) {
          game.phase = 'revealing';
          const currentQuestion = game.questions[game.currentQuestionIndex]!;
          const p1 = game.players[0]!;
          const p2 = game.players[1]!;

          const p1Answer = game.answers[p1.id]?.answerIndex;
          const p2Answer = game.answers[p2.id]?.answerIndex;

          if (p1Answer === currentQuestion.correctIndex) game.scores[p1.id]!++;
          if (p2Answer === currentQuestion.correctIndex) game.scores[p2.id]!++;

          if (game.currentQuestionIndex >= game.questions.length - 1) {
            game.phase = 'game-end';
            const p1Score = game.scores[p1.id] ?? 0;
            const p2Score = game.scores[p2.id] ?? 0;
            const winnerId = p1Score > p2Score ? p1.id : p2Score > p1Score ? p2.id : null;
            game.result = { winnerId, finalScores: { ...game.scores } };
          }
        }
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}