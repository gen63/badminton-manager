import type { Player } from '../types/player';

/** 数値配列の中央値。空配列は 0。偶数個は中間2値の平均 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * gamesPlayed > 0 のプレイヤーの試合数中央値（セッション一覧の実績サマリ用）。
 *
 * 名簿登録だけして参加しなかった人・見学者・0試合の離脱者を含めると中央値が
 * 下振れするため除外する。該当者が0人なら undefined（一覧側で非表示）。
 * `algorithm.ts` の予約保留判定（在席全員が母集団）とは目的が異なるため、
 * 母集団の定義は統一しない。
 */
export function medianGamesPlayed(players: Player[]): number | undefined {
  const played = players.filter((p) => p.gamesPlayed > 0).map((p) => p.gamesPlayed);
  if (played.length === 0) return undefined;
  return median(played);
}
