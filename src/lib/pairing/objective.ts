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
  /** 目的5b: 2-2 のコートを男男 vs 女女（男女戦）に分けない */
  mixSplit: number;
  /** 目的6: 顔ぶれが繰り返されない */
  variety: number;
}

/**
 * `mixSplit` の重み。2-2 のコートは MIX×MIX に分ける（旧エンジンの
 * `splitIntoTeams` はこれをハード制約にしていた）。
 *
 * **形式はソフト制約だが、1.0 では実質ハード制約**。コート4人を実力順に
 * r1<r2<r3<r4、`a = r2−r1`、`b = r4−r3` と置くと、`competitive` が
 * `mixSplit` に打ち勝って男女戦が選ばれる条件は
 *
 * ```
 * 2 * min(a, b) > ロースター人数 − 1
 * ```
 *
 * だが `2*min(a,b) <= a+b <= コート内の実力幅 <= ロースター人数 − 1` が常に
 * 成り立つため、この不等式は決して満たされない（8〜30人で総当たり検算済み。
 * 最悪ケースでもマージン −0.034）。閾値は 0.5〜0.6 の間にあり、0.4 まで
 * 下げると最も釣り合わない構成に限って 0.3〜1.1% で男女戦が出る。
 *
 * バランス上どうしても MIX が組めない場面の逃げ道は、この項ではなく
 * **コート構成のレイヤー**にある。2-2 にせず 4-0 / 3-1 にすればこの項は
 * 適用対象外（`computeMixSplit` は 2-2 のみ判定）で、その判断は `gender` が担う。
 *
 * 値は bench で決定（`docs/plans/2026-08-05-pairing-goals-and-rewrite.md`）。
 */
const MIX_SPLIT_WEIGHT = 1.0;

/**
 * 優先順位（質 > 多様性 > 公平性）を反映した既定値。
 *
 * **重みの大小は優先順位そのものではない。** 各項の正規化スケールが違うため、
 * 「どの重みなら各目的がどこまで達成されるか」を bench で測って決めている。
 * また**効くのは比だけ**なので、ある目的が負けたらその目的の重みを上げる、という
 * 手順で1つずつ詰めた。計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
 *
 * これらの値は**同一プレイヤー重複バグの修正後に取り直したもの**。修正前は破損した
 * 試合が混ざって指標が歪んでいたため、それ以前の調整値は無効。
 *
 * 決めた順序と根拠（21人3コート NOISE=0。既存エンジンは 幅広4.2 / 競り27.1 /
 * 3-1 6.0 / 占有45.7 / 共演13.37 / 試合数幅1.41）:
 *
 * 1. `fairness` = `waiting` **1.5**: 0.9 では試合数幅 2.51。1.5 で 1.53 まで戻る。
 *    2.2 まで上げると 1.19 と既存を追い越すが、3-1 が 4.1% → 6.5% と既存並みに
 *    戻ってしまう（質を落として公平性を買う形）ので採らない
 * 2. `gender` **1.6**: `fairness` を上げた副作用で 3-1 が悪化した（15人3コートで
 *    15.2% と既存 12.1% に負けた）。0.8 → 1.6 で全条件が既存を明確に下回る
 *    （21人3C 1.6% / 15人3C 10.1% / 16人2C 1.7%）。2.6 まで上げても伸びは小さい
 * 3. `variety` **2.6**: 1.2 では「6回組んだペアを再選出しない」という目的6 の
 *    基本的なケース（`algorithm.test.ts` の集中度テスト）を落とす。集計上の
 *    占有率は良くても、偏りそのものを外すのは筋が悪いので上げた
 * 4. `mixSplit` **1.0**: 後から追加（→ `MIX_SPLIT_WEIGHT`）。0.4 では男女戦が
 *    0.3〜1.1% 残り、0.5 で 0.0〜0.1%、0.6 以上で全条件 0.0%。1.0 を採ったのは
 *    閾値（0.5〜0.6）から余裕を取るため。0.4 → 1.0 で他の指標は変わらない
 *    （競り度・占有率・試合数幅とも誤差範囲）
 *
 * 結果、**質・多様性の全指標で既存エンジンを上回り**、劣るのは試合数幅のみ
 * （21人3コートで 2.16 vs 1.41）。
 */
export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  skillGap: 1.0,
  competitive: 1.0,
  gender: 1.6,
  mixSplit: MIX_SPLIT_WEIGHT, // 質
  variety: 2.6, // 多様性
  fairness: 1.5,
  waiting: 1.5, // 公平性
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
  /** 実力の順位（`baseRankById` 相当＝ハシゴ式適用**前**。0始まり）。
   *  実力差の判定（skillGap / ハード制約 / variety のスケール）に使う。 */
  rankById: Map<string, number>;
  /** ハシゴ式（`applyStreakSwaps`）適用**後**の順位。チームの釣り合い（competitive）に使う。
   *  当日の連勝連敗を反映した「今の調子」の序列。 */
  formRankById: Map<string, number>;
  /** ロースター人数（skillGap/competitive の分母 = ロースター人数 − 1） */
  rosterSize: number;
  /** 性別（未設定は undefined） */
  genderById: Map<string, 'M' | 'F' | undefined>;
  preferGenderMix: boolean;
  pairCounts: PairCounts;
  pairKeyOf: (a: string, b: string) => string;
  /** 各候補が「同じコートに入れる相手」の人数。variety の閾値スケールに使う */
  reachableCountById: Map<string, number>;
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
 *
 * 順位は**ハシゴ式適用後**（`formRankById`）を使う。当日勝っている人を強めに、
 * 負けている人を弱めに見積もることで、調子を反映した拮抗した組み合わせになる。
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
 * 目的5b: mixSplit — 2-2 のコートが「男男 vs 女女」に分かれていたら 1.0、
 * MIX×MIX なら 0 の平均。2-2 以外（4-0 / 3-1 / 性別未設定を含む）は判定しない。
 *
 * `gender` はコート4人の男女**構成**しか見ないため、2-2 に整えたあとの
 * チーム分けは `competitive` / `variety` だけで決まってしまう。この項がないと
 * 男女戦が全試合の 15〜17% で発生する（旧エンジンは 0%）。
 */
export function computeMixSplit(
  courts: CourtPlacement[],
  genderById: Map<string, 'M' | 'F' | undefined>
): number {
  if (courts.length === 0) return 0;
  const sum = courts.reduce((s, court) => {
    const genders = courtMembers(court).map(id => genderById.get(id));
    if (genders.some(g => g !== 'M' && g !== 'F')) return s; // 未設定がいれば判定しない
    if (genders.filter(g => g === 'M').length !== 2) return s; // 2-2 のみ対象
    const maleInA =
      (genderById.get(court.teamA[0]) === 'M' ? 1 : 0) +
      (genderById.get(court.teamA[1]) === 'M' ? 1 : 0);
    return s + (maleInA === 1 ? 0 : 1);
  }, 0);
  return clamp01(sum / courts.length);
}

/**
 * 目的6: variety — 各コートで
 * `0.6 * min(1, 最多ペアの共演回数 / 4) + 0.4 * min(1, 6ペアの共演回数合計 / 12)` の平均。
 * 「共演回数」はパートナー回数 + 対戦相手回数。
 *
 * 共演回数は**その2人が組める相手数**で割ってから閾値に当てる（`scaleOf`）。
 */
export function computeVariety(
  courts: CourtPlacement[],
  pairCounts: PairCounts,
  pairKeyOf: (a: string, b: string) => string,
  reachableCountById: Map<string, number>
): number {
  if (courts.length === 0) return 0;
  const together = (a: string, b: string): number => {
    const key = pairKeyOf(a, b);
    return (pairCounts.partner.get(key) ?? 0) + (pairCounts.opponent.get(key) ?? 0);
  };

  // 閾値のスケール。序列の端の人は同居できる相手が片側にしかおらず、組める相手数が
  // 中央の半分程度しかない。同じ回数を回しても共演回数が早く飽和するため、絶対値の
  // 閾値のままだと「避けようのない繰り返し」を罰することになり、端の人ほど
  // ベンチに残されてしまう（実測: 端は中央より 0.7〜0.9 試合少なかった）。
  const reachable = [...reachableCountById.values()].filter(v => v > 0);
  const avgReachable = reachable.length
    ? reachable.reduce((a, b) => a + b, 0) / reachable.length
    : 0;
  const scaleOf = (a: string, b: string): number => {
    if (avgReachable <= 0) return 1;
    const ra = reachableCountById.get(a) ?? avgReachable;
    const rb = reachableCountById.get(b) ?? avgReachable;
    const min = Math.min(ra, rb);
    if (min <= 0) return 1;
    return Math.max(1, avgReachable / min);
  };

  const sum = courts.reduce((s, court) => {
    const members = courtMembers(court);
    let maxRatio = 0;
    let totalRatio = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const scale = scaleOf(members[i], members[j]);
        const ratio = together(members[i], members[j]) / scale;
        if (ratio > maxRatio) maxRatio = ratio;
        totalRatio += ratio;
      }
    }
    const term = 0.6 * Math.min(1, maxRatio / 4) + 0.4 * Math.min(1, totalRatio / 12);
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
    competitive: computeCompetitive(input.courts, input.formRankById, input.rosterSize),
    gender: computeGender(input.courts, input.genderById, input.preferGenderMix),
    mixSplit: computeMixSplit(input.courts, input.genderById),
    variety: computeVariety(
      input.courts,
      input.pairCounts,
      input.pairKeyOf,
      input.reachableCountById
    ),
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
    terms.mixSplit * weights.mixSplit +
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
