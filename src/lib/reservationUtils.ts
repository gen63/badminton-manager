import type { Player } from '../types/player';

export type DoublesCategory = '男子ダブルス' | '女子ダブルス' | 'ミックスダブルス' | null;

/** 選択メンバーの性別構成からダブルスカテゴリを推測 */
export function inferDoublesCategory(
  playerIds: string[],
  players: Player[],
): DoublesCategory {
  if (playerIds.length < 2) return null;
  const genders = playerIds
    .map(id => players.find(p => p.id === id)?.gender)
    .filter((g): g is 'M' | 'F' => g === 'M' || g === 'F');
  if (genders.length !== playerIds.length) return null;
  const maleCount = genders.filter(g => g === 'M').length;
  if (maleCount === 0) return '女子ダブルス';
  if (maleCount === playerIds.length) return '男子ダブルス';
  return 'ミックスダブルス';
}

/** カテゴリの短縮表示 */
export function getCategoryShortLabel(category: DoublesCategory): string | null {
  if (!category) return null;
  switch (category) {
    case '男子ダブルス': return 'ダンダブ';
    case '女子ダブルス': return 'ジョダブ';
    case 'ミックスダブルス': return 'ミックス';
  }
}

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
