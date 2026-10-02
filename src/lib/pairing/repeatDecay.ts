/**
 * 「3人以上一致」の鮮度つき重み。
 *
 * 過去の各試合について、その4人のうち3人組（4通り）ごとに
 * 「その3人のその後の出場数の平均（`since`）」から鮮度（0〜1）を求め、
 * 3人組ごとに最新の共演の鮮度を採る（足し込まない）。時間ではなく**本人たちのその後の試合数**で測るのは、
 * 時間減衰より繰り返し抑制の効きが安定するため（docs/plans/2026-10-02-variety-decay.md）。
 *
 * 鮮度はS字: 2試合後 ≈ 0.9 / 5試合後 ≈ 0.5 / 10試合後 ≈ 0.06。
 * 4人が丸ごと一致すれば 4 つの3人組すべてに当たるので、4人一致専用の項は持たない。
 */
import type { Match } from '../../types/match';

/** 鮮度のS字の形。mid = 半減する試合数、width = なだらかさ */
export const FRESHNESS_SHAPE = { mid: 5, width: 1.8 };

/** その後 `since` 試合した3人組の重み。since=0 で 1、増えるほど 0 に近づく */
export function freshnessWeight(since: number): number {
  const s = Math.max(0, since);
  const { mid, width } = FRESHNESS_SHAPE;
  const sig = (x: number) => 1 / (1 + Math.exp(-x / width));
  return sig(mid - s) / sig(mid);
}

/** 人の並びに依らない組み合わせキー */
export function comboKey(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}

/** 3人組キー → 最新の共演の鮮度（0〜1） */
export function buildTripleWeights(matchHistory: Match[]): Map<string, number> {
  const triple = new Map<string, number>();
  if (matchHistory.length === 0) return triple;

  // 各人の出場通番（1始まり）と総出場数 → 「その試合の後の出場数」
  const ordinal: number[][] = [];
  const total = new Map<string, number>();
  for (const m of matchHistory) {
    const ids = [...m.teamA, ...m.teamB];
    ordinal.push(
      ids.map(id => {
        if (!id) return 0;
        const k = (total.get(id) ?? 0) + 1;
        total.set(id, k);
        return k;
      })
    );
  }

  matchHistory.forEach((m, idx) => {
    const ids = [...m.teamA, ...m.teamB];
    if (ids.some(id => !id)) return; // シングルス等の空きスロットは対象外
    const since = ids.map((id, i) => total.get(id)! - ordinal[idx][i]);
    for (let skip = 0; skip < 4; skip++) {
      const ks = [0, 1, 2, 3].filter(k => k !== skip);
      const key = comboKey(ks.map(k => ids[k]));
      // 同じ3人組が何度も出ていても足し込まず、いちばん新しい共演の鮮度だけを採る
      // （足し込むと小人数で「待っている同じ4人」の点数が青天井になり、公平性を押しのける）
      triple.set(
        key,
        Math.max(triple.get(key) ?? 0, freshnessWeight(ks.reduce((a, k) => a + since[k], 0) / 3))
      );
    }
  });
  return triple;
}
