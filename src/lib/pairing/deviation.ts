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
  /**
   * レートありの人の「外れ値補正」。当日の成績が登録レートからの期待を偶然の範囲（`outlierZ` σ）を
   * 大きく超えたときだけ、超えた分に応じて当日推定へ寄せる。`Infinity` で無効。
   */
  outlierZ: 2.5,
  /** 超過 e = |z| − outlierZ のとき、当日推定への重み w = e ÷ (e + outlierK)。 */
  outlierK: 1,
  /** 登録偏差からの補正幅の上限（偏差の点数）。 */
  outlierCap: 15,
  /** 外れ値判定に必要な最小の勝敗確定試合数（少ない試合数での偶然を拾わない）。 */
  outlierMinGames: 5,
};

/**
 * 勝率の見込みに使う、偏差1点あたりの対数オッズ。偏差10（1SD）差のチーム平均で約1.15、
 * 勝率およそ76%。実メンバー試算（bench）の真の勝敗モデル 10^(差/40)（ペア合計の差）と同じ較正。
 */
export const LOGIT_PER_DEVIATION = (2 * Math.LN10) / 40;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * 登録偏差から見込んだ期待勝数に対する、当日の勝ちの上振れ・下振れ（z = (勝数 − 期待勝数) ÷ 標準偏差）。
 * 履歴画面の「期待比 ±σ」と同じ考え方（期待勝数との差を二項分布の標準偏差で割る）だが、
 * 期待は当日推定ではなく**登録レート由来の偏差**から作る（当日の結果で期待が動かない）。
 * 勝敗確定試合のある人だけ返す。
 */
export function computeOutlierZ(
  prior: ReadonlyMap<string, number>,
  matches: readonly Match[]
): Map<string, { z: number; games: number }> {
  const acc = new Map<string, { wins: number; exp: number; variance: number; games: number }>();
  const meanDev = (team: readonly string[]) =>
    team.reduce((s, id) => s + (prior.get(id) ?? 50), 0) / team.length;
  for (const m of matches) {
    if (!m.winner) continue;
    const a = [...new Set(m.teamA.filter(Boolean))];
    const b = [...new Set(m.teamB.filter(Boolean))];
    if (a.length === 0 || b.length === 0) continue;
    const pA = sigmoid(LOGIT_PER_DEVIATION * (meanDev(a) - meanDev(b)));
    const add = (team: string[], p: number, won: boolean) => {
      for (const id of team) {
        const e = acc.get(id) ?? { wins: 0, exp: 0, variance: 0, games: 0 };
        e.wins += won ? 1 : 0;
        e.exp += p;
        e.variance += p * (1 - p);
        e.games += 1;
        acc.set(id, e);
      }
    };
    add(a, pA, m.winner === 'A');
    add(b, 1 - pA, m.winner === 'B');
  }
  const out = new Map<string, { z: number; games: number }>();
  for (const [id, e] of acc) {
    if (e.variance < 1e-9) continue;
    out.set(id, { z: (e.wins - e.exp) / Math.sqrt(e.variance), games: e.games });
  }
  return out;
}

/**
 * 登録レート由来の偏差（`buildDeviationById`）を、当日の勝敗から推定した偏差で補正する。
 *
 * - 当日推定: 履歴を Bradley-Terry（`performanceRating.ts` と同じ。θ は試合の勝敗だけで決まる）
 *   で解き、**勝敗確定試合がある人の θ の平均・SD** で 平均50・SD10 に標準化して ±3σ（偏差20〜80）で丸める。
 *   登録レート由来の偏差と同じ物差し（ロースター平均50・SD10）に載せるため。
 * - 外れ値補正（レートあり）: 登録偏差から見込んだ期待勝数との差 z が |z|>outlierZ のときだけ、
 *   w = e÷(e+outlierK)（e=|z|−outlierZ）で当日推定へ寄せ、登録偏差から ±outlierCap までに抑える。
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
  const { kUnrated, kRated, outlierZ, outlierK, outlierCap, outlierMinGames } = DAY_ESTIMATE;
  const isUnrated = (p: Pick<Player, 'rating'>) => (p.rating ?? 0) <= 0;
  const outlierOn = outlierZ < Infinity;
  const anyBlended =
    outlierOn || players.some(p => (isUnrated(p) ? kUnrated : kRated) < Infinity);
  if (!anyBlended || matches.length === 0) return prior;

  const est = estimateStrengthsById(matches);
  const members = players.filter(p => est.has(p.id));
  if (members.length < 2) return prior;
  const thetas = members.map(p => est.get(p.id)!.theta);
  const mean = thetas.reduce((s, v) => s + v, 0) / thetas.length;
  const sd = Math.sqrt(thetas.reduce((s, v) => s + (v - mean) ** 2, 0) / thetas.length);
  if (sd < 1e-9) return prior;

  const outlier = outlierOn ? computeOutlierZ(prior, matches) : new Map<string, { z: number; games: number }>();
  const out = new Map(prior);
  for (const p of players) {
    const e = est.get(p.id);
    if (!e || e.games <= 0) continue;
    const z = Math.max(-DEVIATION_Z_CLAMP, Math.min(DEVIATION_Z_CLAMP, (e.theta - mean) / sd));
    const day = 50 + 10 * z;
    const base = prior.get(p.id) ?? 50;
    const k = isUnrated(p) ? kUnrated : kRated;
    if (k < Infinity) {
      const w = e.games / (e.games + Math.max(0, k));
      out.set(p.id, base + w * (day - base));
      continue;
    }
    // レートあり・通常は補正なし。成績が偶然の範囲を大きく超えたときだけ、超過分に応じて補正する
    const o = outlier.get(p.id);
    if (!o || o.games < outlierMinGames) continue;
    const excess = Math.abs(o.z) - outlierZ;
    if (excess <= 0) continue;
    const shift = (excess / (excess + Math.max(0, outlierK))) * (day - base);
    if (shift * o.z <= 0) continue; // 当日推定が成績と逆向きなら補正しない
    out.set(p.id, base + Math.max(-outlierCap, Math.min(outlierCap, shift)));
  }
  return out;
}
