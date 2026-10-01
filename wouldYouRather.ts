import crypto from 'node:crypto';
import type { WyrState, WyrAction, WyrQuestion } from './src/data/peerGames';

const WYR_QUESTIONS: WyrQuestion[] = [
  // Funny
  {
    id: 'f1',
    text: 'Would you rather:',
    optionA: 'Always have to shout everything you say',
    optionB: 'Always have to whisper everything you say',
    category: 'Funny',
  },
  {
    id: 'f2',
    text: 'Would you rather:',
    optionA: 'Have spaghetti for hair',
    optionB: 'Have maple syrup for sweat',
    category: 'Funny',
  },
  {
    id: 'f3',
    text: 'Would you rather:',
    optionA: 'Walk backwards everywhere',
    optionB: 'Skip everywhere you go',
    category: 'Funny',
  },
  {
    id: 'f4',
    text: 'Would you rather:',
    optionA: 'Have a clown nose that honks when you lie',
    optionB: 'Have ears that wiggle when you are happy',
    category: 'Funny',
  },
  {
    id: 'f5',
    text: 'Would you rather:',
    optionA: 'Always speak in rhymes',
    optionB: 'Always speak in riddles',
    category: 'Funny',
  },
  {
    id: 'f6',
    text: 'Would you rather:',
    optionA: 'Have a permanent unibrow',
    optionB: 'Have no eyebrows at all',
    category: 'Funny',
  },

  // Random
  {
    id: 'r1',
    text: 'Would you rather:',
    optionA: 'Be able to fly',
    optionB: 'Be able to become invisible',
    category: 'Random',
  },
  {
    id: 'r2',
    text: 'Would you rather:',
    optionA: 'Live in a treehouse',
    optionB: 'Live in a houseboat',
    category: 'Random',
  },
  {
    id: 'r3',
    text: 'Would you rather:',
    optionA: 'Never have to sleep',
    optionB: 'Never have to eat',
    category: 'Random',
  },
  {
    id: 'r4',
    text: 'Would you rather:',
    optionA: 'Have a pause button for life',
    optionB: 'Have a rewind button for life',
    category: 'Random',
  },
  {
    id: 'r5',
    text: 'Would you rather:',
    optionA: 'Always be 10 minutes late',
    optionB: 'Always be 20 minutes early',
    category: 'Random',
  },
  {
    id: 'r6',
    text: 'Would you rather:',
    optionA: 'Have unlimited WiFi everywhere',
    optionB: 'Have unlimited battery on all devices',
    category: 'Random',
  },
  {
    id: 'r7',
    text: 'Would you rather:',
    optionA: 'Be able to speak all languages',
    optionB: 'Be able to talk to animals',
    category: 'Random',
  },
  {
    id: 'r8',
    text: 'Would you rather:',
    optionA: 'Live without music',
    optionB: 'Live without movies',
    category: 'Random',
  },

  // Gaming
  {
    id: 'g1',
    text: 'Would you rather:',
    optionA: 'Be the main character in an RPG',
    optionB: 'Be the final boss in a fighting game',
    category: 'Gaming',
  },
  {
    id: 'g2',
    text: 'Would you rather:',
    optionA: 'Have infinite ammo',
    optionB: 'Have infinite health',
    category: 'Gaming',
  },
  {
    id: 'g3',
    text: 'Would you rather:',
    optionA: 'Play only single-player games forever',
    optionB: 'Play only multiplayer games forever',
    category: 'Gaming',
  },
  {
    id: 'g4',
    text: 'Would you rather:',
    optionA: 'Have a real-life inventory system',
    optionB: 'Have a real-life minimap',
    category: 'Gaming',
  },
  {
    id: 'g5',
    text: 'Would you rather:',
    optionA: 'Be stuck in a horror game',
    optionB: 'Be stuck in a rage game',
    category: 'Gaming',
  },

  // School
  {
    id: 's1',
    text: 'Would you rather:',
    optionA: 'Have a 3-hour exam with open book',
    optionB: 'Have a 30-minute exam closed book',
    category: 'School',
  },
  {
    id: 's2',
    text: 'Would you rather:',
    optionA: 'Never have homework again',
    optionB: 'Never have group projects again',
    category: 'School',
  },
  {
    id: 's3',
    text: 'Would you rather:',
    optionA: 'Present in front of 100 people',
    optionB: 'Write a 20-page essay',
    category: 'School',
  },
  {
    id: 's4',
    text: 'Would you rather:',
    optionA: 'Have all classes at 8 AM',
    optionB: 'Have all classes at 8 PM',
    category: 'School',
  },
  {
    id: 's5',
    text: 'Would you rather:',
    optionA: 'Study your favorite subject all day',
    optionB: 'Study your least favorite subject for 1 hour',
    category: 'School',
  },

  // Technology
  {
    id: 't1',
    text: 'Would you rather:',
    optionA: 'Never be able to use a smartphone again',
    optionB: 'Never be able to use a computer again',
    category: 'Technology',
  },
  {
    id: 't2',
    text: 'Would you rather:',
    optionA: 'Have AI do all your homework',
    optionB: 'Have AI write all your code',
    category: 'Technology',
  },
  {
    id: 't3',
    text: 'Would you rather:',
    optionA: 'Live in VR forever',
    optionB: 'Never use the internet again',
    category: 'Technology',
  },
  {
    id: 't4',
    text: 'Would you rather:',
    optionA: 'Have a robot butler',
    optionB: 'Have a self-driving car',
    category: 'Technology',
  },
  {
    id: 't5',
    text: 'Would you rather:',
    optionA: 'Always have 1% battery',
    optionB: 'Always have slow WiFi',
    category: 'Technology',
  },

  // Difficult Choices
  {
    id: 'd1',
    text: 'Would you rather:',
    optionA: 'Know when you will die',
    optionB: 'Know how you will die',
    category: 'Difficult Choices',
  },
  {
    id: 'd2',
    text: 'Would you rather:',
    optionA: 'Lose all your memories',
    optionB: 'Never make new memories',
    category: 'Difficult Choices',
  },
  {
    id: 'd3',
    text: 'Would you rather:',
    optionA: 'Be famous but unhappy',
    optionB: 'Be unknown but happy',
    category: 'Difficult Choices',
  },
  {
    id: 'd4',
    text: 'Would you rather:',
    optionA: 'Change one thing about your past',
    optionB: 'See one thing about your future',
    category: 'Difficult Choices',
  },
  {
    id: 'd5',
    text: 'Would you rather:',
    optionA: 'Have the power to read minds',
    optionB: 'Have the power to see the future',
    category: 'Difficult Choices',
  },
];

function getQuestions(category: string, count: number = 10): WyrQuestion[] {
  let pool: WyrQuestion[];
  if (category === 'random') {
    pool = WYR_QUESTIONS;
  } else {
    pool = WYR_QUESTIONS.filter((q) => q.category === category);
    if (pool.length < count) {
      pool = [...pool, ...WYR_QUESTIONS.filter((q) => q.category === 'Random')];
    }
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export class PeerWouldYouRather {
  private state: WyrState = { revision: 0, invitation: null, game: null, leftBy: null };
  private pendingCategory: string = 'Random';

  snapshot(now = Date.now()): WyrState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  /**
   * Per-player view: before both players choose, each player sees only
   * their own choice. After reveal both choices are visible.
   */
  serializeFor(viewerId: string): WyrState {
    const state = this.snapshot();
    const game = state.game;
    if (game && game.phase === 'choosing') {
      const own = game.choices[viewerId];
      game.choices = own ? { [viewerId]: own } : {};
    }
    return state;
  }

  act(actor: string, peers: { id: string; handle: string }[], action: WyrAction): void {
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
      state.leftBy = null;
    } else if (action.action === 'respond') {
      const invitation = state.invitation;
      if (!invitation || invitation.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (action.accept && invitation.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept) {
        const ordered = [...peers].sort((a) => (a.id === invitation.fromId ? -1 : 1));
        const questions = getQuestions(this.pendingCategory);
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer) => ({ ...peer })),
          questions,
          currentQuestionIndex: 0,
          choices: {},
          phase: 'choosing',
          result: null,
          category: this.pendingCategory,
          rematch: [],
        };
      }
      state.invitation = null;
      state.leftBy = null;
    } else if (action.action === 'leave') {
      state.invitation = null;
      if (state.game) {
        const leaver = state.game.players.find((p) => p.id === actor);
        state.leftBy = { id: actor, handle: leaver?.handle ?? 'Your peer' };
        state.game = null;
      }
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
          game.choices = {};
          game.phase = 'choosing';
          game.result = null;
          game.rematch = [];
        }
      } else if (action.action === 'choose') {
        if (game.phase !== 'choosing') throw new Error('Not time to choose.');
        if (game.choices[actor]) throw new Error('You have already chosen.');

        game.choices[actor] = action.choice;

        if (Object.keys(game.choices).length === 2) {
          game.phase = 'revealing';
          const p1 = game.players[0]!;
          const p2 = game.players[1]!;
          const sameChoice = game.choices[p1.id] === game.choices[p2.id];
          game.result = { sameChoice };
        }
      } else if (action.action === 'next') {
        if (game.phase !== 'revealing') throw new Error('Wait for both choices to be revealed.');
        const currentIndex = game.currentQuestionIndex;
        if (currentIndex >= game.questions.length - 1) {
          game.phase = 'round-end';
          game.result = { sameChoice: false };
        } else {
          game.currentQuestionIndex++;
          game.choices = {};
          game.phase = 'choosing';
          game.result = null;
        }
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}
