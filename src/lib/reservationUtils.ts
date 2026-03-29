import type { Player } from '../types/player';

/** プレイヤーがコートに入っておらず、休憩中でもないか判定 */
export function isPlayerReady(
  playerId: string,
  players: Player[],
  playersInCourts: Set<string>,
): boolean {
  const player = players.find(p => p.id === playerId);
  return !!player && !player.isResting && !playersInCourts.has(playerId);
}

/** 予約の全プレイヤーが準備完了かを判定 */
export function getReservationStatus(
  playerIds: string[],
  players: Player[],
  playersInCourts: Set<string>,
): 'ready' | 'waiting' {
  return playerIds.every(id => isPlayerReady(id, players, playersInCourts)) ? 'ready' : 'waiting';
}
