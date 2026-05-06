import type { Match } from '../types/match';
import type { Player } from '../types/player';
import { isMatchOfPlayer } from './matchFilter';

/**
 * 「勝敗未入力 (scoreA===0 && scoreB===0 && !winner)」かつ currentUser が
 * 参加している試合のうち、dismissed (このセッション中だけ覚える「あとで」
 * 集合) を除いた最初の 1 件を返す。
 *
 * matchHistory は append-only (時系列) を仮定し、配列先頭=最古から処理する。
 * 判定式は HistoryPage の未入力判定と同一に保つ。
 */
export function pickNextUnrecordedMatchForUser(
  matchHistory: readonly Match[],
  currentUser: string | null,
  players: readonly Player[],
  dismissed: ReadonlySet<string>,
): Match | null {
  if (!currentUser) return null;
  for (const m of matchHistory) {
    if (dismissed.has(m.id)) continue;
    if (m.scoreA !== 0 || m.scoreB !== 0 || m.winner) continue;
    if (!isMatchOfPlayer(m, currentUser, players as Player[])) continue;
    return m;
  }
  return null;
}
