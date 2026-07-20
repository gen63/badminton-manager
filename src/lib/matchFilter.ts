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

/**
 * 指定プレイヤー視点でのその試合の勝敗を返す。
 * - 勝敗未確定（`winner` 無し = 未入力）や、プレイヤーが参加していない試合は null。
 * - teamA / teamB のどちらに属していても正しく判定する。
 */
export function getMatchResultForPlayer(
  match: Match,
  playerName: string | null,
  players: Player[]
): 'win' | 'loss' | null {
  if (!playerName || !match.winner) return null;
  const nameOf = (id: string) =>
    id ? players.find((p) => p.id === id)?.name : undefined;
  const inTeamA = match.teamA.some((id) => nameOf(id) === playerName);
  const inTeamB = match.teamB.some((id) => nameOf(id) === playerName);
  if (!inTeamA && !inTeamB) return null;
  const playerTeam: 'A' | 'B' = inTeamA ? 'A' : 'B';
  return match.winner === playerTeam ? 'win' : 'loss';
}

export interface PlayerRecord {
  wins: number;
  losses: number;
  total: number;
  /** 勝率（%、0-100 の整数）。total が 0 のときは null。 */
  winRate: number | null;
}

/**
 * 指定プレイヤーの通算成績（勝ち数・負け数・勝率）を集計する。
 * 未入力（勝敗未確定）の試合は total に含めない。
 */
export function computePlayerRecord(
  matches: Match[],
  playerName: string | null,
  players: Player[]
): PlayerRecord {
  let wins = 0;
  let losses = 0;
  for (const match of matches) {
    const result = getMatchResultForPlayer(match, playerName, players);
    if (result === 'win') wins++;
    else if (result === 'loss') losses++;
  }
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : null;
  return { wins, losses, total, winRate };
}
