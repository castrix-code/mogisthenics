import type { GameModeId } from './poses';

export interface Friend {
  username: string;
  elo: number;
  wins: number;
  losses: number;
  online?: boolean;
}

export interface FriendRequest {
  username: string;
  elo: number;
}

export interface IncomingChallenge {
  from: string;
  mode: GameModeId;
}
