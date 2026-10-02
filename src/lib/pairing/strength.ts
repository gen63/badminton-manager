/**
 * 登録レートの「数値」ベースの強さ（実力差の判定用）。
 * `docs/plans/2026-10-02-rating-based-strength.md`
 *
 * 順位（0..n-1）だけで実力差を測ると、端の人（ロースター内で飛び抜けて高い／低い人）
 * の離れ具合を過小評価する（順位では隣の人と1つ差でも、レートでは大きく離れていることがある）。
 * ここではロースター内で登録レートを標準化（z-score、±`zClamp` で外れ値を丸める）し、
 * `zSpan` で割って「順位幅 ÷（人数−1）」とほぼ同じ 0〜1 の目盛りにそろえる。
 *
 * 未設定レート（0 / undefined）の人は平均（z=0）扱い。`buildInitialOrder` が未設定者を
 * 上位 1/3 の直後（中位）に入れるのと同じ「まだ分からない人は真ん中」の方針。
 *
 * **副作用なし・外部依存なし**（`objective.ts` から import されるので循環参照を作らない）。
 */
import type { Player } from '../../types/player';

/** 書き換え可能（bench / 実メンバー試算が上書きして比較できるようにしてある） */
export const STRENGTH_SHAPE = {
  /** skillGap（コート内の最大−最小）のうち数値ベースの割合。0 で従来どおり（順位のみ） */
  gapMix: 1,
  /** competitive（チーム差）のうち数値ベースの割合。0 で従来どおり（順位のみ） */
  compMix: 1,
  /** z をこの値で割って 0〜1 の目盛りにする（一様な順位幅 ≒ 3.46σ に対応） */
  zSpan: 3.5,
  /** 外れ値の丸め。|z| がこれを超えたら止める */
  zClamp: 3,
  /**
   * 当日の勝敗補正（ハシゴ式の序列移動）を数値にも反映する強さ。
   * 0 = 登録レートのみ。1 = ハシゴ式で動いた順位幅をそのまま（順位÷（人数−1））強さに足す。
   */
  ladder: 0,
};

/** 標準化した強さ（高いほど強い。目盛りは概ね −0.9〜+0.9）。未設定者は 0 */
export function buildStrengthById(
  players: Pick<Player, 'id' | 'rating'>[],
  shape: Pick<typeof STRENGTH_SHAPE, 'zSpan' | 'zClamp'> = STRENGTH_SHAPE
): Map<string, number> {
  const rated = players.filter(p => (p.rating ?? 0) > 0);
  const out = new Map<string, number>();
  const mean = rated.length ? rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length : 0;
  const variance = rated.length
    ? rated.reduce((s, p) => s + ((p.rating ?? 0) - mean) ** 2, 0) / rated.length
    : 0;
  const sd = Math.sqrt(variance);
  for (const p of players) {
    const r = p.rating ?? 0;
    if (r <= 0 || sd === 0) {
      out.set(p.id, 0);
      continue;
    }
    const z = Math.max(-shape.zClamp, Math.min(shape.zClamp, (r - mean) / sd));
    out.set(p.id, z / shape.zSpan);
  }
  return out;
}

/**
 * 当日の勝敗補正つきの強さ。ハシゴ式で登録順位より上がった人は強く、下がった人は弱く見積もる。
 * `ladder` が 0 なら `strength` そのまま。
 */
export function buildFormStrengthById(
  strength: Map<string, number>,
  baseRankById: Map<string, number>,
  formRankById: Map<string, number>,
  ladder: number = STRENGTH_SHAPE.ladder
): Map<string, number> {
  if (ladder === 0) return strength;
  const denom = Math.max(1, baseRankById.size - 1);
  const out = new Map<string, number>();
  for (const [id, s] of strength) {
    const moved = (baseRankById.get(id) ?? 0) - (formRankById.get(id) ?? baseRankById.get(id) ?? 0);
    out.set(id, s + (ladder * moved) / denom);
  }
  return out;
}
