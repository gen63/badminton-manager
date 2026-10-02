/**
 * 配置の「点数表」と、コート単位の採点。
 *
 * ## 共通通貨: 偏差何点分の悪さか
 *
 * すべてのソフト項を「偏差（登録レートをその日のロースターで偏差値化: 平均50・SD10。
 * `deviation.ts`）何点分の悪さか」に換算したコストにする。コストは**小さいほど良い**
 * 単なる足し算で、重みの掛け合わせや 0〜1 の正規化はない。点数表は `SCORE_TABLE` の1枚だけ。
 * 設計: docs/plans/2026-10-02-simplify-scoring.md
 *
 * ## 採点の対象（1ラウンド = 全コートの合計）
 *
 * - コートごと: コート内の最大−最小 / チーム平均の差 / 3人以上一致 / 連続 / 男女バランス /
 *   ペア希望（同コートで敵）
 * - ラウンド全体: 試合数の公平性 / ペア希望（別コート・ベンチ）
 *
 * ハード制約（公平性の窓・「必ず」ペア・極端な実力差）は点数ではなく `assignRound.ts` が
 * 違反数として数え、違反が少ない解を必ず点数より先に選ぶ。
 *
 * **副作用なし・外部依存なし**。`algorithm.ts` を import しないこと（循環参照防止）。
 */

import { comboKey } from './repeatDecay';

/** 1コート分の配置（4人 = teamA 2人 + teamB 2人） */
export interface CourtPlacement {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
}

/** ペア希望（normal）1組。2人が味方になれば0点、そうでなければ `pairPref` 点 */
export interface AffinityPair {
  a: string;
  b: string;
}

/** 男女バランスの点数（コート1つ分） */
export interface GenderPoints {
  /** 男女3対1（男3女1 / 男1女3） */
  threeOne: number;
  /** 2-2 を 男男 vs 女女（男女戦）に分けた */
  split: number;
  /** 4-0（同性だけ）。少数派が少ないセッション（`preferGenderMix`）のときだけ課す */
  fourZero: number;
}

/**
 * 点数表。**各値は「偏差何点分の悪さか」**。bench / テストが書き換えられるよう mutable。
 * 調整の経緯と根拠（実メンバー試算・bench）は docs/plans/2026-10-02-simplify-scoring.md。
 */
export const SCORE_TABLE = {
  // ── レベル差（最優先） ──
  /** コート内の最大−最小。偏差が1点開くごとに 2.5 点 */
  courtSpan: 2.5,
  /** コート内の最大−最小が偏差20を超えた分は、1点につきさらに 5 点上乗せ（大差ほど強く嫌う凸形） */
  courtSpanKnee: 20,
  courtSpanExcess: 5,
  /** チーム平均の差。平均偏差が1点開くごとに 3 点（= 2チームの偏差合計の差 × 1.5） */
  teamDiff: 3,

  // ── 顔ぶれ・連続 ──
  /** 3人以上一致。同じ3人組が前に一緒だった鮮度（0〜1）× 28 点を、コートの4つの3人組ぶん足す（4人一致は最大 112 点） */
  tripleRepeat: 28,
  /** 連続出場。2連続目 5 点 / 3連続目 25 点 / 4連続目以上 100 点 */
  streak: [5, 25, 100] as readonly number[],

  // ── 男女バランス（コート1つにつき） ──
  /** 男女比調整 ON: 男女3対1 = 40 点 / 男男 vs 女女 = 30 点 / 4-0（少数派が少ないセッションのみ）= 20 点 */
  genderOn: { threeOne: 40, split: 30, fourZero: 20 } as GenderPoints,
  /** 男女比調整 OFF: 小さい値を残す（実力の釣り合いが明確に良くなる時だけ許す）。12 / 14 / 6 点 */
  genderOff: { threeOne: 12, split: 14, fourZero: 6 } as GenderPoints,

  // ── ペア希望 ──
  /** 希望ペア（normal）の2人が味方にならない（別コート・ベンチ・同コートで敵）1組あたり 50 点 */
  pairPref: 50,

  // ── 試合数の公平性 ──
  /**
   * 控えの人より試合数換算で1試合分多い人を出す（＝逆転）。出場者×控えの組ごとに 15 点。
   * 2試合分の逆転は 4 倍、3試合分は 9 倍（二乗）。
   */
  fairnessPerGame: 15,
  /** 逆転の大きさは 3 試合分までしか数えない（滞在時間が短い人の優先度が極端に大きく出ても、他の項を押し流さない） */
  fairnessCapGames: 3,
  /** 後半均等化モードでは公平性の点数を 4 倍にする */
  lateFairnessMultiplier: 4,

  // ── ハード制約の閾値 ──
  /** コート内の偏差の最大−最小がこの値以上なら違反（極端な実力差。人数に関係なく適用） */
  extremeSpan: 30,
};

/** 採点に必要な入力一式（ラウンド内で不変） */
export interface ScoreContext {
  /** 偏差（平均50・SD10）。未登録の人は 50 扱い */
  deviationById: Map<string, number>;
  genderById: Map<string, 'M' | 'F' | undefined>;
  /** 男女比調整 ON か */
  genderBalanceOn: boolean;
  /** 少数派性別が少ないセッションか（4-0 を軽く嫌う） */
  preferGenderMix: boolean;
  /** 3人組キー → 鮮度つき重み（`repeatDecay.ts`） */
  tripleWeights: Map<string, number>;
  /** 連続出場数（`streak.ts`）。連続していない人は入れない */
  streakById: Map<string, number>;
  affinityPairs: AffinityPair[];
  /**
   * 候補ごとの「試合数換算の優先度」。**小さいほど先に出すべき人**。
   * 優先度スコアを「1試合分の差」で割った値（`assignRound.ts` が作る）。
   */
  needById: Map<string, number>;
}

const dev = (ctx: ScoreContext, id: string): number => ctx.deviationById.get(id) ?? 50;

/** コート内の偏差の最大−最小。`ignorePair` の2人の間だけは比べない（ペア「必ず」の2人） */
export function courtSpan(
  ids: readonly string[],
  deviationById: Map<string, number>,
  ignorePairs: readonly { a: string; b: string }[] = []
): number {
  let span = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (ignorePairs.some(({ a, b }) => (ids[i] === a && ids[j] === b) || (ids[i] === b && ids[j] === a))) {
        continue;
      }
      const d = Math.abs((deviationById.get(ids[i]) ?? 50) - (deviationById.get(ids[j]) ?? 50));
      if (d > span) span = d;
    }
  }
  return span;
}

/** n連続目（streak = 直近の連続出場数。1 なら今回が2連続目）の点数 */
export function streakPoints(streak: number | undefined): number {
  if (streak === undefined || !Number.isFinite(streak) || streak < 1) return 0;
  const t = SCORE_TABLE.streak;
  return t[Math.min(streak, t.length) - 1] ?? 0;
}

/** 男女バランスの点数（コート1つ分。チーム分けに依存するのは 男男 vs 女女 だけ） */
export function genderPoints(
  teamA: readonly string[],
  teamB: readonly string[],
  ctx: Pick<ScoreContext, 'genderById' | 'genderBalanceOn' | 'preferGenderMix'>
): number {
  const gs = [...teamA, ...teamB].map(id => ctx.genderById.get(id));
  if (gs.some(g => g !== 'M' && g !== 'F')) return 0; // 未設定がいれば判定しない
  const t = ctx.genderBalanceOn ? SCORE_TABLE.genderOn : SCORE_TABLE.genderOff;
  const males = gs.filter(g => g === 'M').length;
  if (males === 1 || males === 3) return t.threeOne;
  if (males === 0 || males === 4) return ctx.preferGenderMix ? t.fourZero : 0;
  const maleInA = teamA.filter(id => ctx.genderById.get(id) === 'M').length;
  return maleInA === 1 ? 0 : t.split;
}

/** 同コートで敵になっているペア希望の点数（味方なら0） */
function enemyPairPoints(teamA: readonly string[], teamB: readonly string[], pairs: AffinityPair[]): number {
  let n = 0;
  for (const { a, b } of pairs) {
    const aA = teamA.includes(a);
    const aB = teamB.includes(a);
    const bA = teamA.includes(b);
    const bB = teamB.includes(b);
    if ((aA && bB) || (aB && bA)) n++;
  }
  return n * SCORE_TABLE.pairPref;
}

/** コート1つ分の点数の内訳 */
export interface CourtBreakdown {
  span: number;
  teamDiff: number;
  triple: number;
  streak: number;
  gender: number;
  pairEnemy: number;
  total: number;
}

/** チーム分けに依らない部分: コート内の最大−最小・3人以上一致・連続 */
export function courtFixedPoints(ids: readonly string[], ctx: ScoreContext): { span: number; triple: number; streak: number } {
  const rawSpan = courtSpan(ids, ctx.deviationById);
  const span =
    SCORE_TABLE.courtSpan * rawSpan +
    SCORE_TABLE.courtSpanExcess * Math.max(0, rawSpan - SCORE_TABLE.courtSpanKnee);

  let triple = 0;
  if (ctx.tripleWeights.size > 0) {
    const sorted = [...ids].sort();
    for (let skip = 0; skip < 4; skip++) {
      triple += ctx.tripleWeights.get(comboKey(sorted.filter((_, k) => k !== skip))) ?? 0;
    }
    triple *= SCORE_TABLE.tripleRepeat;
  }

  let streak = 0;
  if (ctx.streakById.size > 0) for (const id of ids) streak += streakPoints(ctx.streakById.get(id));
  return { span, triple, streak };
}

/** チーム分けに依る部分: チーム平均の差・男女バランス・ペア希望（同コートで敵） */
export function splitPoints(
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  ctx: ScoreContext
): { teamDiff: number; gender: number; pairEnemy: number } {
  const sumA = dev(ctx, teamA[0]) + dev(ctx, teamA[1]);
  const sumB = dev(ctx, teamB[0]) + dev(ctx, teamB[1]);
  return {
    teamDiff: SCORE_TABLE.teamDiff * (Math.abs(sumA - sumB) / 2),
    gender: genderPoints(teamA, teamB, ctx),
    pairEnemy: enemyPairPoints(teamA, teamB, ctx.affinityPairs),
  };
}

export function courtBreakdown(
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  ctx: ScoreContext
): CourtBreakdown {
  const fixed = courtFixedPoints([...teamA, ...teamB], ctx);
  const split = splitPoints(teamA, teamB, ctx);
  return {
    ...fixed,
    ...split,
    total: fixed.span + fixed.triple + fixed.streak + split.teamDiff + split.gender + split.pairEnemy,
  };
}

export const courtPoints = (
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  ctx: ScoreContext
): number => courtBreakdown(teamA, teamB, ctx).total;

/**
 * 試合数の公平性。出場者 s と控え b の組すべてについて、s のほうが試合数換算で多い
 * （＝本来は b が先に出るべきだった「逆転」）ぶんを足し、`fairnessPerGame` を掛ける。
 * 優先度の高い人を外す／低い人を出す、の両方がこの1項で表される。
 * 逆転が1試合分なら 1 組につき `fairnessPerGame` 点、2試合分なら 4 倍、3試合分なら 9 倍（二乗。
 * 2試合以上遅れる人を作らないための強さ。`fairnessCapGames` 試合分で頭打ち）。
 */
export function fairnessPoints(
  selectedIds: readonly string[],
  benchIds: readonly string[],
  needById: Map<string, number>,
  lateBalance = false
): number {
  let inversions = 0;
  for (const s of selectedIds) {
    const ns = needById.get(s) ?? 0;
    for (const b of benchIds) {
      const d = ns - (needById.get(b) ?? 0);
      if (d > 0) inversions += Math.min(d, SCORE_TABLE.fairnessCapGames) ** 2;
    }
  }
  return SCORE_TABLE.fairnessPerGame * (lateBalance ? SCORE_TABLE.lateFairnessMultiplier : 1) * inversions;
}

/**
 * ペア希望のうち、同コートで味方・敵のどちらでもない（別コート・ベンチ）ぶんの点数。
 * 同コートの敵は `courtBreakdown.pairEnemy` 側で数えるのでここでは数えない。
 * `poolIds` = このラウンドの候補全員。プールに居ないペアは対象外。
 */
export function looseAffinityPoints(
  courtIdOf: Map<string, number>,
  poolIds: ReadonlySet<string>,
  pairs: AffinityPair[]
): number {
  let n = 0;
  for (const { a, b } of pairs) {
    if (!poolIds.has(a) || !poolIds.has(b)) continue;
    const ca = courtIdOf.get(a);
    const cb = courtIdOf.get(b);
    if (ca === undefined || cb === undefined || ca !== cb) n++;
  }
  return n * SCORE_TABLE.pairPref;
}
