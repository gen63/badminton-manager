import type { Match } from '../types/match';
import type { Player } from '../types/player';

/**
 * 指定したプレイヤー名が試合に参加しているか判定する。
 * playerName が null の場合や、該当プレイヤーが players に見つからない場合は false。
 * teamA / teamB の空文字（シングルス相手枠）は player ID として一致しないため安全。
 */
export function isMatchOfPlayer(
  match: Match,
  playerName: string | null,
  players: Player[]
): boolean {
  if (!playerName) return false;
  const playerIds = [...match.teamA, ...match.teamB];
  for (const id of playerIds) {
    if (!id) continue;
    const name = players.find((p) => p.id === id)?.name;
    if (name === playerName) return true;
  }
  return false;
}
