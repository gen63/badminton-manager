import type { Court } from './court';
import type { Player } from './player';
import type { Match } from './match';
import type { Reservation } from './reservation';

export interface UndoEntry {
  courts: Court[];
  players: Player[];
  matchHistory: Match[];
  reservations?: Reservation[];
  continuousMatchMode?: boolean;
  timestamp: number;
}
