import crypto from 'node:crypto';
import type { RpsState, RpsAction, RpsChoice } from './src/data/peerGames';

const BEATS: Record<RpsChoice, RpsChoice> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export class PeerRockPaperScissors {
  private state: RpsState = { revision: 0, invitation: null, game: null, leftBy: null };

  snapshot(now = Date.now()): RpsState {
    if (this.state.invitation && this.state.invitation.expiresAt <= now) {
      this.state.invitation = null;
      this.state.revision++;
    }
    return structuredClone(this.state);
  }

  /**
   * Per-player view: before a round is revealed each player sees only
   * their own choice. After reveal both choices are visible.
   */
  serializeFor(viewerId: string): RpsState {
    const state = this.snapshot();
    const game = state.game;
    if (game && game.turn === 'choosing') {
      const own = game.choices[viewerId];
      game.choices = own ? { [viewerId]: own } : {};
      for (const player of game.players) {
        if (player.id !== viewerId) player.choice = null;
      }
    }
    return state;
  }

  act(actor: string, peers: { id: string; handle: string }[], action: RpsAction): void {
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
      state.leftBy = null;
    } else if (action.action === 'respond') {
      const invitation = state.invitation;
      if (!invitation || invitation.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (action.accept && invitation.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept) {
        const ordered = [...peers].sort((a) => (a.id === invitation.fromId ? -1 : 1));
        state.game = {
          id: crypto.randomUUID(),
          round: 1,
          players: ordered.map((peer) => ({ ...peer, choice: null })),
          choices: {},
          scores: { [ordered[0]!.id]: 0, [ordered[1]!.id]: 0 },
          draws: 0,
          locked: [],
          turn: 'choosing',
          result: null,
          bestOf: 3,
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
          game.players.forEach((p) => {
            p.choice = null;
          });
          game.choices = {};
          game.scores = { [game.players[0]!.id]: 0, [game.players[1]!.id]: 0 };
          game.draws = 0;
          game.locked = [];
          game.turn = 'choosing';
          game.result = null;
          game.rematch = [];
        }
      } else if (action.action === 'next') {
        if (game.turn !== 'revealing') throw new Error('Finish the current round first.');
        game.round++;
        game.players.forEach((p) => {
          p.choice = null;
        });
        game.choices = {};
        game.locked = [];
        game.turn = 'choosing';
        game.result = null;
      } else if (action.action === 'choose') {
        if (game.turn !== 'choosing') throw new Error('It is not time to choose.');
        if (game.result) throw new Error('This round is over.');
        if (game.choices[actor]) throw new Error('You have already chosen.');
        if (action.choice !== 'rock' && action.choice !== 'paper' && action.choice !== 'scissors')
          throw new Error('Choose rock, paper, or scissors.');

        game.choices[actor] = action.choice;
        const player = game.players.find((p) => p.id === actor)!;
        player.choice = action.choice;
        if (!game.locked.includes(actor)) game.locked.push(actor);

        if (Object.keys(game.choices).length === 2) {
          game.turn = 'revealing';
          const p1 = game.players[0]!;
          const p2 = game.players[1]!;
          const c1 = game.choices[p1.id]!;
          const c2 = game.choices[p2.id]!;

          const isDraw = c1 === c2;
          const winnerId = isDraw ? null : BEATS[c1] === c2 ? p1.id : p2.id;
          if (isDraw) {
            game.draws++;
          } else {
            game.scores[winnerId!]!++;
          }

          const reason = isDraw
            ? 'Draw!'
            : winnerId === p1.id
              ? `${p1.handle} wins the round!`
              : `${p2.handle} wins the round!`;
          game.result = { winnerId, reason };

          const maxScore = Math.ceil(game.bestOf / 2);
          const hasWinner = Object.values(game.scores).some((s) => s >= maxScore);
          if (hasWinner) {
            game.turn = 'round-end';
            const p1Score = game.scores[p1.id] ?? 0;
            const p2Score = game.scores[p2.id] ?? 0;
            const finalWinner = p1Score > p2Score ? p1.id : p2.id;
            const winnerHandle = game.players.find((p) => p.id === finalWinner)!.handle;
            game.result = { winnerId: finalWinner, reason: `${winnerHandle} wins the match!` };
          }
        }
      } else throw new Error('Invalid game action.');
    }
    state.revision++;
  }
}
