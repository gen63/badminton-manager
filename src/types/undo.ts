import type { Court } from './court';
import type { Player } from './player';
import type { Match } from './match';
import type { Reservation } from './reservation';

export interface UndoEntry {
  courts: Court[];
  players: Player[];
  matchHistory: Match[];
  reservations?: Reservation[];
  /** sync 系の設定。snapshot 後にユーザーが変えても undo で巻き戻したい */
  continuousMatchMode?: boolean;
  recordScores?: boolean;
  practiceType?: '単' | '複' | '楽';
  timestamp: number;
}
