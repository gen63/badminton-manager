/**
 * 登録レートを「偏差」（当日のロースター内で 平均50・SD10）に直す。
 *
 * 配置の点数（`objective.ts` の `SCORE_TABLE`）はすべてこの偏差の「何点分の悪さか」で
 * 測る。レートの絶対値は会によって違うので、その日の全アクティブメンバー
 * （他コート中を含む）の分布で標準化する。
 *
 * - 偏差 = 50 + 10 × z。z は ±3 で丸める（偏差 20〜80）
 * - レート未設定（0 以下）は平均 = 偏差 50 扱い。平均・SD の母集団にも入れない
 * - 全員同じレート（SD=0）なら全員 50
 */
import type { Player } from '../../types/player';
import type { Match } from '../../types/match';
import { estimateStrengthsById } from '../performanceRating';

export const DEVIATION_Z_CLAMP = 3;

export function buildDeviationById(
  players: Pick<Player, 'id' | 'rating'>[]
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
      out.set(p.id, 50);
      continue;
    }
    const z = Math.max(-DEVIATION_Z_CLAMP, Math.min(DEVIATION_Z_CLAMP, (r - mean) / sd));
    out.set(p.id, 50 + 10 * z);
  }
  return out;
}

/**
 * 当日の試合結果による補正の強さ（縮小推定の k。重み w = n ÷ (n + k)、n = 勝敗確定試合数）。
 * mutable（bench / テストが書き換える）。調整の根拠は docs/plans/2026-10-02-simplify-scoring.md。
 * - `kUnrated`: レート未設定の人。小さいほど早く当日の推定に寄る
 * - `kRated`: レートありの人。大きいほど登録レートを信じる。`Infinity` で補正なし
 */
export const DAY_ESTIMATE = {
  kUnrated: 4,
  kRated: Infinity,
};

/**
 * 登録レート由来の偏差（`buildDeviationById`）を、当日の勝敗から推定した偏差で補正する。
 *
 * - 当日推定: 履歴を Bradley-Terry（`performanceRating.ts` と同じ。θ は試合の勝敗だけで決まる）
 *   で解き、**勝敗確定試合がある人の θ の平均・SD** で 平均50・SD10 に標準化して ±3σ（偏差20〜80）で丸める。
 *   登録レート由来の偏差と同じ物差し（ロースター平均50・SD10）に載せるため。
 * - 補正: 偏差 = 事前 + w × (当日推定 − 事前)。事前 = 登録レート由来の偏差（未設定は 50）、
 *   w = n ÷ (n + k)。試合数 n が少ないうちは事前（50）寄り、増えるほど当日推定寄り。
 *   k は未設定とレートありで別（`DAY_ESTIMATE`）。n = 0 の人・勝敗が無い履歴では補正されない。
 * - 決定的: 履歴の値だけから決まる（`Date.now()` 非依存）。補正する人が居なければ BT を解かない。
 */
export function buildBlendedDeviationById(
  players: Pick<Player, 'id' | 'rating'>[],
  matches: readonly Match[]
): Map<string, number> {
  const prior = buildDeviationById(players);
  const { kUnrated, kRated } = DAY_ESTIMATE;
  const isUnrated = (p: Pick<Player, 'rating'>) => (p.rating ?? 0) <= 0;
  const anyBlended = players.some(p => (isUnrated(p) ? kUnrated : kRated) < Infinity);
  if (!anyBlended || matches.length === 0) return prior;

  const est = estimateStrengthsById(matches);
  const members = players.filter(p => est.has(p.id));
  if (members.length < 2) return prior;
  const thetas = members.map(p => est.get(p.id)!.theta);
  const mean = thetas.reduce((s, v) => s + v, 0) / thetas.length;
  const sd = Math.sqrt(thetas.reduce((s, v) => s + (v - mean) ** 2, 0) / thetas.length);
  if (sd < 1e-9) return prior;

  const out = new Map(prior);
  for (const p of players) {
    const e = est.get(p.id);
    if (!e || e.games <= 0) continue;
    const k = isUnrated(p) ? kUnrated : kRated;
    if (!(k < Infinity)) continue;
    const z = Math.max(-DEVIATION_Z_CLAMP, Math.min(DEVIATION_Z_CLAMP, (e.theta - mean) / sd));
    const day = 50 + 10 * z;
    const w = e.games / (e.games + Math.max(0, k));
    const base = prior.get(p.id) ?? 50;
    out.set(p.id, base + w * (day - base));
  }
  return out;
}
