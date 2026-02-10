import type { Court } from './court';
import type { Player } from './player';
import type { Match } from './match';

export interface UndoEntry {
  courts: Court[];
  players: Player[];
  matchHistory: Match[];
  timestamp: number;
}
