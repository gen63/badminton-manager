/**
 * 目的関数（6目的の正規化・重み付き合計）。
 *
 * `docs/plans/2026-08-05-pairing-goals-and-rewrite.md` の「やりたいこと（6個）」に
 * 1目的1指標で対応する。すべて 0〜1 に正規化し、重み付き合計する純関数群。
 *
 * **副作用なし・外部依存なし**。`algorithm.ts` を import しないこと（循環参照防止）。
 */

/** 1コート分の配置（4人 = teamA 2人 + teamB 2人） */
export interface CourtPlacement {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
}

export interface ObjectiveWeights {
  /** 目的1: 出場機会が均等 */
  fairness: number;
  /** 目的2: 待ち時間が偏らない */
  waiting: number;
  /** 目的3: 実力差（ハード制約を超えない範囲のソフト分） */
  skillGap: number;
  /** 目的4: 競る試合になる */
  competitive: number;
  /** 目的5: 性別構成が偏らない */
  gender: number;
  /** 目的6: 顔ぶれが繰り返されない */
  variety: number;
}

/**
 * 優先順位（質 > 多様性 > 公平性）を反映した既定値。
 *
 * **重みの大小は優先順位そのものではない。** 各項の正規化スケールが違うため、
 * 「どの重みなら各目的がどこまで達成されるか」を bench で測って決めている。
 * 計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
 *
 * - `fairness` / `waiting` 0.9: 0.15 では試合数幅が 4.33（既存エンジンは 1.41）と
 *   「15ラウンドで7試合の人と11試合の人が出る」規模になり許容できない。0.9 で 2.49 まで戻る。
 *   **公平性は候補プールの絞り込み（試合数の上振れガードや控えの人数制限）では
 *   ほとんど動かず、重みで買うのが最も安かった**（同じ試合数幅なら重みの方が質が良い）。
 * - `variety` 2.0: `fairness` を上げると多様性が巻き添えで落ちるため、そのぶん引き上げる。
 *   2.0 で占有率・共演の**両方**が既存エンジンを上回る（21人3コート NOISE=0 で
 *   占有率 43.4% vs 既存 45.7%、共演 13.44 vs 13.37）。2.8 まで上げると多様性は
 *   さらに伸びるが試合数幅が 2.89 に戻ってしまう。
 *
 * この組で **質・多様性の全指標が既存エンジンを上回り**、公平性だけが劣る
 * （試合数幅は条件により既存の 1.3〜2.5 倍）。
 */
export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  skillGap: 1.0,
  competitive: 1.0,
  gender: 0.8, // 質
  variety: 2.0, // 多様性
  fairness: 0.9,
  waiting: 0.9, // 公平性
};

/** パートナー/対戦相手の回数集計（呼び出し側の HistoryCounts.pair と同じ形） */
export interface PairCounts {
  partner: Map<string, number>;
  opponent: Map<string, number>;
}

/** 目的関数の評価に必要な入力一式 */
export interface ObjectiveInput {
  /** このラウンドで配置するコート */
  courts: CourtPlacement[];
  /** 選ばれなかった候補（控え） */
  benchIds: string[];
  /** 優先度順位（0始まり、小さいほど優先＝待っている）。候補プール全員分 */
  priorityRankById: Map<string, number>;
  /** 優先度順位を計算した候補プールの人数（fairness/waiting の分母） */
  candidateCount: number;
  /** 実力の順位（`baseRankById` 相当。0始まり） */
  rankById: Map<string, number>;
  /** ロースター人数（skillGap/competitive の分母 = ロースター人数 − 1） */
  rosterSize: number;
  /** 性別（未設定は undefined） */
  genderById: Map<string, 'M' | 'F' | undefined>;
  preferGenderMix: boolean;
  pairCounts: PairCounts;
  pairKeyOf: (a: string, b: string) => string;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function courtMembers(court: CourtPlacement): string[] {
  return [court.teamA[0], court.teamA[1], court.teamB[0], court.teamB[1]];
}

/**
 * 目的1: fairness — 選ばれた人の「優先度順位 ÷ 候補数」の平均。
 * 待っている人ほど優先度順位が小さいので、低いほど公平（優先度どおりに選ばれている）。
 */
export function computeFairness(
  courts: CourtPlacement[],
  priorityRankById: Map<string, number>,
  candidateCount: number
): number {
  if (candidateCount <= 0) return 0;
  const selected = courts.flatMap(courtMembers);
  if (selected.length === 0) return 0;
  const sum = selected.reduce((s, id) => {
    const rank = priorityRankById.get(id);
    return s + (rank === undefined ? 0 : rank / candidateCount);
  }, 0);
  return clamp01(sum / selected.length);
}

/**
 * 目的2: waiting — 選ばれなかった人のうち最も待っている人の
 * 「1 − 優先度順位 ÷ 候補数」。最優先の人を外すほど 1 に近づく。
 */
export function computeWaiting(
  benchIds: string[],
  priorityRankById: Map<string, number>,
  candidateCount: number
): number {
  if (candidateCount <= 0 || benchIds.length === 0) return 0;
  let worst = 0;
  for (const id of benchIds) {
    const rank = priorityRankById.get(id);
    if (rank === undefined) continue;
    const value = 1 - rank / candidateCount;
    if (value > worst) worst = value;
  }
  return clamp01(worst);
}

/**
 * 目的3: skillGap — 各コートの「順位の最大 − 最小」÷（ロースター人数 − 1）の平均。
 */
export function computeSkillGap(
  courts: CourtPlacement[],
  rankById: Map<string, number>,
  rosterSize: number
): number {
  if (courts.length === 0) return 0;
  const denom = Math.max(1, rosterSize - 1);
  const sum = courts.reduce((s, court) => {
    const ranks = courtMembers(court)
      .map(id => rankById.get(id))
      .filter((r): r is number => r !== undefined);
    if (ranks.length === 0) return s;
    const gap = Math.max(...ranks) - Math.min(...ranks);
    return s + gap / denom;
  }, 0);
  return clamp01(sum / courts.length);
}

/**
 * 目的4: competitive — 各コートの
 * 「|チームAの順位合計 − チームBの順位合計| ÷（ロースター人数 − 1）」の平均。
 * 0 に近いほど競る試合（実力が拮抗している）。
 */
export function computeCompetitive(
  courts: CourtPlacement[],
  rankById: Map<string, number>,
  rosterSize: number
): number {
  if (courts.length === 0) return 0;
  const denom = Math.max(1, rosterSize - 1);
  const rankOf = (id: string): number => rankById.get(id) ?? 0;
  const sum = courts.reduce((s, court) => {
    const sumA = rankOf(court.teamA[0]) + rankOf(court.teamA[1]);
    const sumB = rankOf(court.teamB[0]) + rankOf(court.teamB[1]);
    return s + Math.abs(sumA - sumB) / denom;
  }, 0);
  return clamp01(sum / courts.length);
}

/**
 * 目的5: gender — 各コートで 3-1 なら 1.0、4-0 なら `preferGenderMix ? 0.5 : 0`、
 * 2-2 なら 0 の平均。性別未設定のメンバーがいるコートは判定しない（0扱い）。
 */
export function computeGender(
  courts: CourtPlacement[],
  genderById: Map<string, 'M' | 'F' | undefined>,
  preferGenderMix: boolean
): number {
  if (courts.length === 0) return 0;
  const sum = courts.reduce((s, court) => {
    const genders = courtMembers(court).map(id => genderById.get(id));
    if (genders.some(g => g !== 'M' && g !== 'F')) return s; // 未設定がいれば判定しない
    const maleCount = genders.filter(g => g === 'M').length;
    if (maleCount === 1 || maleCount === 3) return s + 1.0;
    if (maleCount === 0 || maleCount === 4) return s + (preferGenderMix ? 0.5 : 0);
    return s; // 2-2
  }, 0);
  return clamp01(sum / courts.length);
}

/**
 * 目的6: variety — 各コートで
 * `0.6 * min(1, 最多ペアの共演回数 / 4) + 0.4 * min(1, 6ペアの共演回数合計 / 12)` の平均。
 * 「共演回数」はパートナー回数 + 対戦相手回数。
 */
export function computeVariety(
  courts: CourtPlacement[],
  pairCounts: PairCounts,
  pairKeyOf: (a: string, b: string) => string
): number {
  if (courts.length === 0) return 0;
  const together = (a: string, b: string): number => {
    const key = pairKeyOf(a, b);
    return (pairCounts.partner.get(key) ?? 0) + (pairCounts.opponent.get(key) ?? 0);
  };
  const sum = courts.reduce((s, court) => {
    const members = courtMembers(court);
    const pairSums: number[] = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        pairSums.push(together(members[i], members[j]));
      }
    }
    const maxPair = pairSums.length ? Math.max(...pairSums) : 0;
    const total = pairSums.reduce((a, b) => a + b, 0);
    const term = 0.6 * Math.min(1, maxPair / 4) + 0.4 * Math.min(1, total / 12);
    return s + term;
  }, 0);
  return clamp01(sum / courts.length);
}

/** 6目的すべてを計算した結果（各 0〜1） */
export type ObjectiveTerms = ObjectiveWeights;

export function computeObjectiveTerms(input: ObjectiveInput): ObjectiveTerms {
  return {
    fairness: computeFairness(input.courts, input.priorityRankById, input.candidateCount),
    waiting: computeWaiting(input.benchIds, input.priorityRankById, input.candidateCount),
    skillGap: computeSkillGap(input.courts, input.rankById, input.rosterSize),
    competitive: computeCompetitive(input.courts, input.rankById, input.rosterSize),
    gender: computeGender(input.courts, input.genderById, input.preferGenderMix),
    variety: computeVariety(input.courts, input.pairCounts, input.pairKeyOf),
  };
}

/** 6項目を重み付き合計する（合計 = 目的関数値。小さいほど良い） */
export function weightedObjective(
  terms: ObjectiveTerms,
  weights: ObjectiveWeights
): number {
  return (
    terms.fairness * weights.fairness +
    terms.waiting * weights.waiting +
    terms.skillGap * weights.skillGap +
    terms.competitive * weights.competitive +
    terms.gender * weights.gender +
    terms.variety * weights.variety
  );
}

/** 入力から目的関数値（重み付き合計）を直接計算する */
export function evaluateObjective(
  input: ObjectiveInput,
  weights: ObjectiveWeights
): number {
  return weightedObjective(computeObjectiveTerms(input), weights);
}
