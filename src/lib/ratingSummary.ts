import type { Player } from '../types/player';

/**
 * レート登録済み（`rating > 0`）プレイヤーの平均レート（セッション一覧のメンバー層サマリ用）。
 *
 * 対象は `Player.rating` = **名簿の初期レート**（tmp シートの `skill` 由来で、人が付けた
 * 序列決定用の値）。その日の勝敗から解く `performanceRating`（1500 基準）とは別物で、
 * スケールも運用側の入力次第（実運用は 16〜40 程度・小数2桁）。桁を仮定した整数丸めは
 * しない。
 *
 * 母集団は**名簿上の全プレイヤー**。試合数で絞らないのは、開催前（全員
 * `gamesPlayed = 0`）でも「その日集まる面子の層」を見たいため。実績サマリである
 * `medianGamesPlayed`（`gamesPlayed > 0` 限定）とは目的が違うので母集団は統一しない。
 *
 * 未レート（`rating` 未設定 or 0）は除外する。0 は「レート0の弱い人」ではなく
 * 「実力不明」を表す値で（`buildInitialOrder` も 0 を序列の中位へ挿入する扱いで、
 * 数値としては使っていない）、母集団に入れると平均が実態より大きく下振れするため。
 *
 * 該当0人なら undefined（一覧側で非表示）。小数第1位で丸める。
 */
export function averagePlayerRating(players: Player[]): number | undefined {
  const ratings = players.map((p) => p?.rating ?? 0).filter((r) => r > 0);
  if (ratings.length === 0) return undefined;
  const sum = ratings.reduce((acc, r) => acc + r, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
