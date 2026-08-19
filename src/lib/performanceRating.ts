import type { Match } from '../types/match';
import type { Player } from '../types/player';

/**
 * その日のセッション内での「強さ」を、対戦相手・味方の強さを加味して推定する。
 *
 * 単純な勝率だと「弱い相手とばかり当たった結果の高勝率」と「強い相手に勝った
 * 高勝率」を区別できないため、全試合を連立で解く Bradley-Terry モデルを使う。
 * 詳細は docs/plans/2026-07-27-performance-rating.md を参照。
 */

/** レートの基準値。その日の平均的な選手が 1500 になる。 */
export const BASE_RATING = 1500;

/** 自然対数オッズ → Elo 風レートへの変換係数（400 点差 = 勝率 10:1）。 */
const RATING_SCALE = 400 / Math.LN10;

/**
 * 事前分布の強さ（L2 正則化係数）。正則化が無いと全勝者の強さが発散するため
 * 必須。試合数が少ない人ほど平均（θ=0）へ引き戻される。
 */
const PRIOR_STRENGTH = 0.5;

const MAX_ITERATIONS = 500;
const CONVERGENCE_TOLERANCE = 1e-10;
/** 対角ニュートン法が踏み込み過ぎないよう 1 反復あたりの更新量を制限する。 */
const MAX_STEP = 0.5;

export interface PlayerPerformance {
  name: string;
  wins: number;
  losses: number;
  /** 勝敗が確定した試合数（未入力の試合は含まない）。 */
  total: number;
  /** 勝率（%、0-100 の整数）。total が 0 のときは null。 */
  winRate: number | null;
  /**
   * 本日のパフォーマンスレート（1500 基準の整数）。
   *
   * **`deviation` と同じ情報**（どちらも推定した強さ θ の一次変換）で、順位も一致する。
   * 1500 は「その日の平均」なのでセッションを跨いだ比較には使えない。UI では
   * 誤解を避けるため表示しておらず、並び替えの内部処理にのみ使う。
   */
  rating: number;
  /**
   * 強さ偏差値（平均 50 / 標準偏差 10 の**整数**）。
   *
   * 真の実力が既知の集団で 200 セッション測ると**誤差は ±5.5 ポイント**あるため、
   * 小数を出すと精度を大きく偽ることになる。整数に丸めて、誤差の範囲内の人が
   * 同じ値になるようにしている。
   */
  deviation: number;
  /** 同じ `deviation` なら同順位（1,2,2,4 形式）。 */
  displayRank: number;
  /** 対戦した相手チームの平均レート（整数）。 */
  opponentRating: number;
  /** 対戦した相手チームの平均を偏差値スケールにしたもの（整数）。 */
  opponentDeviation: number;
  /** 味方（ペア相手）の平均レート。シングルスのみの場合は null。 */
  partnerRating: number | null;
  /** 味方の平均を偏差値スケールにしたもの。シングルスのみの場合は null。 */
  partnerDeviation: number | null;
  /** その枠に平均的な選手が入った場合の期待勝利数（小数第1位まで）。 */
  expectedWins: number;
  /** 同じく期待勝率（%、0-100 の整数）。total が 0 のときは null。 */
  expectedWinRate: number | null;
  /** 実勝利数 − 期待勝利数。相手の強さを補正した上振れ分（小数第1位まで）。 */
  winsAboveExpected: number;
  /**
   * `winsAboveExpected` の標準誤差（二項分布 sqrt(n*q*(1-q))、小数第2位まで）。
   * 1日分の試合数（10〜15試合）では 1.4〜1.9 程度になる。
   */
  winsAboveExpectedError: number;
  /**
   * 上振れが偶然では説明しにくいか（|上振れ| >= 1.96 * 標準誤差）。
   * **1日分のデータではほとんどの人が false になる**（2026-08-11 の実データでは
   * 21人中 1人だけ）。レートの順位を「その日の強さ順」として読ませないための情報。
   */
  isSignificant: boolean;
}

export interface PerformanceResult {
  /** レート降順（同レートは勝ち数 → 五十音）。勝敗確定試合がある人のみ。 */
  players: PlayerPerformance[];
  /** 集計対象になった試合数（勝敗が確定し、両チームに有効なメンバーがいる試合）。 */
  ratedMatchCount: number;
}

/** 勝敗が確定し、名前解決済みのメンバーだけが残った試合。 */
interface RatedMatch {
  teamA: string[];
  teamB: string[];
  winnerIsA: boolean;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Match[] を推定に使える形へ整形する。
 * - `winner` が無い試合（結果未入力）は除外
 * - `players` に存在しない ID・シングルスの空文字枠はメンバーから除外
 * - 片方のチームが空になった試合はスキップ（比較情報にならないため）
 */
function toRatedMatches(matches: Match[], players: Player[]): RatedMatch[] {
  const nameById = new Map<string, string>();
  for (const p of players) {
    if (p.name) nameById.set(p.id, p.name);
  }

  const resolve = (ids: readonly string[]): string[] => {
    const names: string[] = [];
    for (const id of ids) {
      const name = id ? nameById.get(id) : undefined;
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  };

  const rated: RatedMatch[] = [];
  for (const match of matches) {
    if (!match.winner) continue;
    const teamA = resolve(match.teamA);
    const teamB = resolve(match.teamB);
    if (teamA.length === 0 || teamB.length === 0) continue;
    rated.push({ teamA, teamB, winnerIsA: match.winner === 'A' });
  }
  return rated;
}

const teamStrength = (team: string[], theta: Map<string, number>): number => {
  let sum = 0;
  for (const name of team) sum += theta.get(name) ?? 0;
  return sum / team.length;
};

/**
 * 正則化付き Bradley-Terry の最尤（MAP）推定。対角ニュートン法で解く。
 *
 * 目的関数: Σ log P(観測) − (λ/2)Σθ²
 * P(A 勝) = sigmoid(mean(θ_A) − mean(θ_B))
 *
 * 全 θ に定数を足しても尤度は変わらないが、L2 項が中心を 0 に固定するため
 * 解は一意。オンライン Elo と違い試合順に依存しない。
 */
function solveStrengths(
  ratedMatches: RatedMatch[],
  names: string[]
): Map<string, number> {
  const theta = new Map<string, number>(names.map((n) => [n, 0]));
  if (names.length === 0) return theta;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const gradient = new Map<string, number>(names.map((n) => [n, 0]));
    const curvature = new Map<string, number>(names.map((n) => [n, 0]));

    for (const match of ratedMatches) {
      const predicted = sigmoid(
        teamStrength(match.teamA, theta) - teamStrength(match.teamB, theta)
      );
      const residual = (match.winnerIsA ? 1 : 0) - predicted;
      const weight = predicted * (1 - predicted);

      const nA = match.teamA.length;
      for (const name of match.teamA) {
        gradient.set(name, gradient.get(name)! + residual / nA);
        curvature.set(name, curvature.get(name)! + weight / (nA * nA));
      }
      const nB = match.teamB.length;
      for (const name of match.teamB) {
        gradient.set(name, gradient.get(name)! - residual / nB);
        curvature.set(name, curvature.get(name)! + weight / (nB * nB));
      }
    }

    let maxStep = 0;
    for (const name of names) {
      const current = theta.get(name)!;
      const g = gradient.get(name)! - PRIOR_STRENGTH * current;
      const h = curvature.get(name)! + PRIOR_STRENGTH;
      const step = clamp(g / h, -MAX_STEP, MAX_STEP);
      theta.set(name, current + step);
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    if (maxStep < CONVERGENCE_TOLERANCE) break;
  }

  return theta;
}

/**
 * セッション内のパフォーマンス指標を算出する。
 * 勝敗が確定した試合が 1 つも無い場合は空の結果を返す。
 */
export function computePerformanceRatings(
  matches: Match[],
  players: Player[]
): PerformanceResult {
  const ratedMatches = toRatedMatches(matches, players);
  if (ratedMatches.length === 0) {
    return { players: [], ratedMatchCount: 0 };
  }

  const names: string[] = [];
  for (const match of ratedMatches) {
    for (const name of [...match.teamA, ...match.teamB]) {
      if (!names.includes(name)) names.push(name);
    }
  }

  const theta = solveStrengths(ratedMatches, names);
  const ratingOf = (name: string) =>
    BASE_RATING + (theta.get(name) ?? 0) * RATING_SCALE;

  // 偏差値の母集団は「勝敗確定試合がある人」全員。sd が 0（全員同じ強さ）の
  // ときは 0 除算になるため一律 50 とする。
  const thetaValues = names.map((n) => theta.get(n) ?? 0);
  const mean = thetaValues.reduce((a, b) => a + b, 0) / thetaValues.length;
  const variance =
    thetaValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / thetaValues.length;
  const sd = Math.sqrt(variance);

  const stats = new Map<
    string,
    {
      wins: number;
      losses: number;
      opponentRatingSum: number;
      partnerRatingSum: number;
      partnerCount: number;
      expectedWins: number;
    }
  >(
    names.map((n) => [
      n,
      {
        wins: 0,
        losses: 0,
        opponentRatingSum: 0,
        partnerRatingSum: 0,
        partnerCount: 0,
        expectedWins: 0,
      },
    ])
  );

  const averageRating = (team: string[]) =>
    team.reduce((sum, n) => sum + ratingOf(n), 0) / team.length;

  for (const match of ratedMatches) {
    const strengthA = teamStrength(match.teamA, theta);
    const strengthB = teamStrength(match.teamB, theta);

    const accumulate = (team: string[], opponents: string[], won: boolean) => {
      const ownStrength = team === match.teamA ? strengthA : strengthB;
      const opponentStrength = team === match.teamA ? strengthB : strengthA;
      const opponentAverage = averageRating(opponents);
      for (const name of team) {
        const stat = stats.get(name)!;
        if (won) stat.wins++;
        else stat.losses++;
        stat.opponentRatingSum += opponentAverage;
        for (const partner of team) {
          if (partner === name) continue;
          stat.partnerRatingSum += ratingOf(partner);
          stat.partnerCount++;
        }
        // その枠に平均的な選手（θ=0）が入った場合の勝利期待値。
        // チーム強さは平均なので、本人の θ を抜いた分だけ下がる（or 上がる）。
        const withoutSelf = ownStrength - (theta.get(name) ?? 0) / team.length;
        stat.expectedWins += sigmoid(withoutSelf - opponentStrength);
      }
    };

    accumulate(match.teamA, match.teamB, match.winnerIsA);
    accumulate(match.teamB, match.teamA, !match.winnerIsA);
  }

  const result: PlayerPerformance[] = names.map((name) => {
    const stat = stats.get(name)!;
    const total = stat.wins + stat.losses;
    const rating = Math.round(ratingOf(name));
    const deviation =
      sd > 1e-9 ? 50 + (10 * ((theta.get(name) ?? 0) - mean)) / sd : 50;
    // レート → 偏差値スケールの変換。相手/味方の平均も同じ物差しに載せる
    const toDeviation = (r: number): number =>
      sd > 1e-9 ? 50 + (10 * ((r - BASE_RATING) / RATING_SCALE - mean)) / sd : 50;
    return {
      name,
      wins: stat.wins,
      losses: stat.losses,
      total,
      winRate: total > 0 ? Math.round((stat.wins / total) * 100) : null,
      rating,
      deviation: Math.round(deviation),
      displayRank: 0, // ソート後に採番する
      opponentRating: Math.round(stat.opponentRatingSum / total),
      opponentDeviation: Math.round(toDeviation(stat.opponentRatingSum / total)),
      partnerRating:
        stat.partnerCount > 0
          ? Math.round(stat.partnerRatingSum / stat.partnerCount)
          : null,
      partnerDeviation:
        stat.partnerCount > 0
          ? Math.round(toDeviation(stat.partnerRatingSum / stat.partnerCount))
          : null,
      expectedWins: round1(stat.expectedWins),
      expectedWinRate:
        total > 0 ? Math.round((stat.expectedWins / total) * 100) : null,
      winsAboveExpected: round1(stat.wins - stat.expectedWins),
      ...((): { winsAboveExpectedError: number; isSignificant: boolean } => {
        const q = total > 0 ? stat.expectedWins / total : 0;
        const error = Math.sqrt(total * q * (1 - q));
        const above = stat.wins - stat.expectedWins;
        return {
          winsAboveExpectedError: Math.round(error * 100) / 100,
          isSignificant: error > 0 && Math.abs(above) >= 1.96 * error,
        };
      })(),
    };
  });

  // 表示は偏差値（整数）順。同じ偏差値のときは**登録レートが高い方**を上にする。
  // 日次の推定は誤差 ±5.5 と粗く、同値なら事前情報（登録レート）に従うのが
  // 納得感が高いため。登録レートが無い/同値なら勝ち数 → 五十音。
  const registeredRating = new Map<string, number>();
  for (const p of players) {
    if (p.name) registeredRating.set(p.name, p.rating ?? 0);
  }
  result.sort((a, b) => {
    if (b.deviation !== a.deviation) return b.deviation - a.deviation;
    const ra = registeredRating.get(a.name) ?? 0;
    const rb = registeredRating.get(b.name) ?? 0;
    if (rb !== ra) return rb - ra;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name, 'ja');
  });

  // 同じ偏差値は同順位。次の順位は人数分飛ばす（1, 2, 2, 4 形式）
  result.forEach((p, index) => {
    p.displayRank =
      index > 0 && result[index - 1].deviation === p.deviation
        ? result[index - 1].displayRank
        : index + 1;
  });

  return { players: result, ratedMatchCount: ratedMatches.length };
}

/** 指定した名前のパフォーマンスを取り出す。該当が無ければ null。 */
export function findPerformance(
  result: PerformanceResult,
  name: string | null
): PlayerPerformance | null {
  if (!name) return null;
  return result.players.find((p) => p.name === name) ?? null;
}
