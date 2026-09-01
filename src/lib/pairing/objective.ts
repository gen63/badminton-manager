/**
 * 目的関数（7目的の正規化・重み付き合計）。
 *
 * `docs/plans/2026-08-05-pairing-goals-and-rewrite.md` の「やりたいこと（6個）」に
 * 1目的1指標で対応する（目的1〜6）。すべて 0〜1 に正規化し、重み付き合計する
 * 純関数群。目的7 `affinity`（ペア希望）は
 * `docs/plans/2026-08-31-pair-preference.md` で追加。
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
  /** 目的7: ペア希望（`affinity`）— 特定2人が組む頻度を上げる。0〜1・小さいほど良い */
  affinity: number;
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
 * `skillGap` の重み。1.0 → **1.5**。
 *
 * ## 何を直したか
 *
 * `gender` は 3-1 のコートに一律 1.0（重み 1.6）を課すのに対し、それが防いでいる
 * 実力面の損は `skillGap` = 順位幅 ÷（人数−1）で実際には 0.3〜0.6 程度しかなく、
 * **gender が 3〜5 倍強い**。そのため少数派（男女比の少ない側）が2人だけで序列の
 * 両端にいると、2-2 を作るためだけに序列全体をまたぐコートを組んでしまう。
 * 13人3コート（男11 + 女2、女性が序列2位と12位）で:
 *
 * ```
 * 1.0  幅7 / 幅3 / 幅11   ← 強い方の女性が最下位の男性と組んで最上位と当たる
 * 1.5  幅3 / 幅3 / 幅4
 * ```
 *
 * 1.2 で既に直り、1.5 まで同じ結果。14人以上では順位差のハード制約
 * （`WIDE_RANK_SPAN_MIN_ROSTER`）が既に止めるので、症状は 12〜13人でのみ出る。
 * 12人3コートは 2.5 まで上げないと直らないが、そこは払わない（後述）。
 *
 * ## なぜ `gender` を下げるのではなく `skillGap` を上げるのか
 *
 * **3-1 も男女戦も避けるのが原則**であり、それは変わっていない。`gender` を下げる
 * のは「3-1 への嫌悪を弱める」方向で原則に反し、実測でも実力と無関係な場面まで
 * 3-1 が増える（2-2 のコートだけ順位幅を縛る案では、12人3コートで 3-1 が +8.0pt
 * 増えるのに幅広% は 45.0 → 45.2 とまったく改善しなかった）。`skillGap` を上げる
 * のは「**序列をまたぐことへの嫌悪を強める**」方向で原則を緩めず、3-1 は
 * 「帯を崩さずに 2-2 が作れなかった残余」としてだけ現れる。
 *
 * ## 値（SEEDS=60 NOISE=0、幅広% / 3-1%）
 *
 * | 条件 | 1.0 | **1.5** | 2.0 | 2.5 |
 * |---|---|---|---|---|
 * | 13人3C | 42.9 / 14.6 | 39.8 / 14.6 | 38.2 / 15.9 | 37.8 / 15.4 |
 * | 16人2C | 35.6 / 2.1  | 33.6 / 2.4  | 32.8 / 2.8  | 29.9 / 3.1 |
 * | 18人3C | 31.2 / 3.1  | 29.8 / 3.3  | 27.7 / 3.7  | 27.4 / 4.3 |
 * | 21人3C | 26.6 / 1.7  | 25.3 / 1.9  | 24.7 / 2.3  | 22.8 / 2.8 |
 *
 * **1.5 は幅広% が全条件で 1.3〜2.0pt 改善し、3-1% の増加は +0.0〜0.3pt に留まる。**
 * 2.0 以上は 3-1% と多様性・公平性の代償が急に増える（2.0 でユニットテストが
 * 3件、2.5 でさらに落ちる）ので採らない。
 *
 * ## 前提: 同点レートの扱い
 *
 * この引き上げは `buildRanksWithTies`（同点レートを同順位にする）とセット。
 * 同点に別々の順位が振られたままだと架空の順位差にペナルティがかかり、
 * `skillGap` を上げるほどそれが増幅される（全員 1500 のセッションで
 * `preferGenderMix` が壊れた）。順番を逆にしてはいけない。
 *
 * この重みは男女比調整の ON/OFF に関係なく効く（`GENDER_BALANCE_OFF_WEIGHTS` は
 * `skillGap` を上書きしない）。帯を崩さないことは性別の設定とは独立の原則のため。
 */
const SKILL_GAP_WEIGHT = 1.5;

/**
 * `affinity` の重み。2.0 → **1.0**（飽和廃止にあわせて再計測。
 * `docs/plans/2026-08-31-pair-preference.md` 6d.）。
 *
 * ## なぜ測り直したか
 *
 * 2.0 は「実績比率が目標に届いたら押すのをやめる」**飽和つき**の `normal` を
 * 前提に決めた値だった。2026-09-01 に飽和を廃止して常に最大強度で押し続ける
 * 仕様へ変えたため、同じ重みでも実効的な効き目が強くなり、測り直しが要る。
 *
 * ## 値（22人3C / 16人2C、ペア6通りの平均・各60ラウンド）
 *
 * 成立率 = 2人が味方だった試合 ÷ min(2人の試合数)。
 * 相方 = その人が組んだことのある相手の人数（多様性の代理指標）。
 *
 * | 重み | 22人3C 成立率 / 相方 | 16人2C 成立率 / 相方 |
 * |---|---|---|
 * | （希望なし） | 11% / 13.0人 | 11% / 10.2人 |
 * | 0.5 | 49% / 11.0人 | 35% / 9.2人 |
 * | 0.7 | 57% / 10.0人 | 33% / 9.7人 |
 * | **1.0** | **64% / 8.2人** | **39% / 8.5人** |
 * | 2.0 | 82% / 5.7人 | 61% / 7.5人 |
 *
 * **1.0 を採る。** 2.0 は成立率こそ高いが、通常最大の22人3コートで相方が
 * 13.0人 → 5.7人（−56%）まで痩せ、「ほぼ毎回このペア」になって他のメンバーと
 * 組む機会を奪う。1.0 なら成立率 64%（希望なしの約6倍）を確保しつつ相方は
 * 8.2人残る。運用意図は「必ず一緒」ではなく「組みやすくする」であり、
 * それは `必ず`（`strong`）のハード制約が別に担っている。
 *
 * ## 試合数リークも 1.0 の方が良い
 *
 * 希望ペア当事者の試合数 − 全体中央値（plan の合格条件は +0.5 未満）:
 *
 * | 重み | 22人3C | 16人2C |
 * |---|---|---|
 * | 1.0 | +0.08 | +0.42 |
 * | 2.0 | +0.00 | **+0.58** |
 *
 * **2.0 は16人2コートで +0.58 と合格条件を超えていた**（飽和を外した副作用。
 * 飽和ありで測った当時は ±0.35 に収まっていた）。1.0 で +0.42 に収まる。
 *
 * ## 下げすぎない理由
 *
 * 0.5 は相方をほぼ完全に保つ（11.0人）が、16人2コートで成立率が 35% まで落ちる。
 * 2コート運用は候補プールが小さく `variety` の抵抗が相対的に強いので、ここが
 * 効き目の下限を決める。0.4 では 27% とほぼ「希望なし」に近づく。
 */
const AFFINITY_WEIGHT = 1.0;

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
 * 5. `skillGap` **1.5**: 後から 1.0 → 1.5 に引き上げ（→ `SKILL_GAP_WEIGHT`）
 *
 * 結果、**質・多様性の全指標で既存エンジンを上回り**、劣るのは試合数幅のみ
 * （21人3コートで 2.16 vs 1.41）。
 */
export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  skillGap: SKILL_GAP_WEIGHT,
  competitive: 1.0,
  gender: 1.6,
  mixSplit: MIX_SPLIT_WEIGHT, // 質
  variety: 2.6, // 多様性
  fairness: 1.5,
  waiting: 1.5, // 公平性
  affinity: AFFINITY_WEIGHT, // ペア希望（bench 実測。根拠は AFFINITY_WEIGHT のコメント参照）
};

/**
 * 「男女比調整」をオフにしたときの重み上書き。
 *
 * オフでも**完全には無効化しない**。`gender` を下げると 3-1 のコートが増え、
 * `mixSplit` を下げると男女戦（男男 vs 女女）が出るようになるが、どちらも
 * 0 にすると「実力差に関係なく常時そうなる」ため、小さい値を残して
 * **実力の釣り合いが明確に良くなるときだけ**そうなるようにしている。
 *
 * bench（SEEDS=60 NOISE=0、21人3コート）でのオン → オフ:
 *   3-1%      1.7% → 8.9%
 *   男女戦%   0.0% → 2.3%（30試合に1回程度）
 *   競り度    27.7 → 27.2
 *
 * **試合の拮抗度はほとんど変わらない。** `skillGap` と順位差のハード制約が既に
 * 帯を作っており、性別の調整はその帯の中で行われているだけなので、性別の重みを
 * 下げても選べる相手は増えない（`gender` を 1.6 → 0.2 の 8 分の 1 にしても
 * 競り度は 27.7 → 26.6 しか動かなかった）。オフで変わるのは男女比だけ。
 *
 * `mixSplit` の 0.2 は「上位2人と下位2人の実力差が両方 2 順位以上」で発動する値。
 * 0.4 だと 0.1〜0.2% しか出ず設定を切った意味が体感できず、0 にすると 2 割を
 * 超えて常時許容になる。
 */
export const GENDER_BALANCE_OFF_WEIGHTS: Partial<ObjectiveWeights> = {
  gender: 0.6,
  mixSplit: 0.2,
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
  /** 登録レートそのままの順位（ハシゴ式適用**前**。0始まり）。
   *  登録レートは `formRankById` の初期値を決めるためだけに存在するので、
   *  目的関数はこれを参照しない（互換のため型には残している）。 */
  rankById: Map<string, number>;
  /** ハシゴ式（`applyStreakSwaps`）適用**後**の順位＝**実働の序列**。
   *  登録レートはこの序列の初期値でしかなく、以後は当日の勝敗で上下する。
   *  帯の形成（skillGap）・チームの釣り合い（competitive）はこちらを使う。 */
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
  /** 希望ペアの一覧（実運用は1〜3組程度） */
  affinityPairs: AffinityPair[];
}

/**
 * ペア希望1組ぶんの評価入力。
 *
 * **`deficit` フィールドは持たない（2026-09-01 に廃止）。** 旧版は
 * 「実績比率が目標に届くと 0 になって押すのをやめる」飽和つき不足度だったが、
 * 常に最大強度で押し続ける仕様に変更したため、常に 1.0 として扱うのと
 * 同じ値を持ち回す意味が無くなった。呼び出し側（`pairPreference.ts`）で
 * 「対象にするかどうか」（候補プールにいるか・公平性ガード）だけを判定し、
 * 対象になったペアはそのまま `{ a, b }` として渡す。
 *
 * `pairKey` の Map ではなく配列にしているのは性能上の理由。`pairKey` は
 * `[a, b].sort().join(',')` のような不可逆な文字列で、キーから2人の ID を
 * 復元できない。Map 形式だと `computeAffinity` は「候補プールの全ペア
 * （n人なら n(n-1)/2 組）を毎回列挙してキーを引く」しかできず、局所探索が
 * `evaluate()` を数万回呼ぶ構造と組み合わさって実測 4〜8倍の性能回帰になった
 * （22〜25人3コートで計測）。希望ペアは実運用で1〜3組しかないため、配列に
 * すれば「希望ペアだけを回して、その2人がどこにいるか調べる」向きになり、
 * 候補人数に依存しない O(希望組数) で済む。
 */
export interface AffinityPair {
  a: string;
  b: string;
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
 *
 * 順位は**ハシゴ式適用後**（`formRankById`）を使う。新エンジンにはグループ分けの
 * 独立した工程が無く、この項と順位差のハード制約が帯の形成を兼ねているため、
 * ここで登録レートを見ると帯がハシゴ式に一切追随しなくなる（旧エンジンは
 * `groupPlayers3Court` がハシゴ式適用後の序列で帯を作っていた）。
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

/**
 * 目的7: affinity — ペア希望（`docs/plans/2026-08-31-pair-preference.md`）。
 * 「特定の2人の組む確率を上げたい」を、`variety` に対抗するソフトなペナルティ項
 * として表現する。0〜1・小さいほど良い（他項と同じ）。
 *
 * ```
 * 評価対象 = affinityPairs のうち、両者がこのラウンドの配置対象
 *            （courts ∪ benchIds）に現れるものだけ
 * ペアごとの寄与:
 *   味方（同コートで partner）  → 0
 *   同コートで敵                → 0.5
 *   別コート / 片方以上がベンチ → 1.0
 * affinity = Σ(寄与) ÷ 評価対象ペア数（対象0件なら 0）
 * ```
 *
 * **2026-09-01 に飽和（実績比率ベースの `deficit`）を廃止した。** 旧版は
 * 「実績比率が目標に届くと 0 になって押すのをやめる」不足度でスケールしていたが、
 * 今は対象ペアには常に最大強度（寄与をそのまま足す）で押し続ける。`普通`
 * （`strong` のハード制約を伴わない側）と `必ず` の違いは、目的関数のこの項
 * だけを見ると無くなり、**`必ず` はこれに加えて `evaluate()` 側のハード制約
 * （`StrongPair`）を持つかどうかだけ**になった。公平性ガード（`gamesPlayed`
 * が中央値+閾値以上のメンバーを含むペアを対象から外す）は呼び出し側
 * （`pairPreference.ts` の `computeAffinityPairs`）が引き続き担う。
 *
 * **なぜ評価対象ペア数で割るのか。** 全項が 0〜1 に正規化されている前提を
 * 崩さないため。固定ペナルティのまま足すと、希望を1組登録しただけで他の6目的
 * との重み比が意図せず変わってしまう（10組登録しても総影響量は変わらない
 * ようにしたい）。平均を取ることで「予算制」になり、組数が増えるほど
 * 1組あたりの効き目は薄まる一方、配置全体への総影響量は一定に保たれる。
 *
 * **1組しか登録されていないとき、その1組は分母1で最大強度になる。** 複数組
 * 登録されていれば互いに薄め合うが、1組だけならこの項の値がそのまま寄与に
 * なる。意味としては「1組しか希望していないなら全力で尊重する」で妥当だが、
 * 重み（`AFFINITY_WEIGHT`）を決めるときはこの「1組だけ」のケースを最悪ケース
 * として基準にしないと、`skillGap` を押し切って実力差の大きいペアを無理に
 * 成立させてしまう（bench で確認する）。
 *
 * 「両者ともこのラウンドの配置対象に現れないペア」は分母から外れる。この関数は
 * `courts`（出場）と `benchIds`（控え）の**和集合**を「このラウンドの配置対象」
 * とみなし、`affinityPairs` の各要素についてその判定をするだけなので、
 * 一方でも現れないペアは自然に除外される（呼び出し側で追加のフィルタは要らない）。
 *
 * **走査の向き（性能）。** コート所属・パートナーの Map は出場者数ぶん
 * （courts ∪ benchIds、実運用で最大25人程度）1回だけ構築するが、それを使って
 * 「候補プールの全ペア」を回すのではなく**`affinityPairs`（実運用1〜3組）だけ**
 * を回す。候補プールの全ペアを回う実装は局所探索が `evaluate()` を数万回呼ぶ
 * 構造と組み合わさって実測 4〜8倍の性能回帰になったため、`AffinityPair` を
 * 配列にしてこの向きにしている（`AffinityPair` のコメント参照）。
 */
export function computeAffinity(
  courts: CourtPlacement[],
  benchIds: string[],
  affinityPairs: AffinityPair[]
): number {
  if (affinityPairs.length === 0) return 0;

  const courtIndexById = new Map<string, number>();
  const partnerOfId = new Map<string, string>();
  courts.forEach((court, courtIndex) => {
    for (const id of courtMembers(court)) courtIndexById.set(id, courtIndex);
    partnerOfId.set(court.teamA[0], court.teamA[1]);
    partnerOfId.set(court.teamA[1], court.teamA[0]);
    partnerOfId.set(court.teamB[0], court.teamB[1]);
    partnerOfId.set(court.teamB[1], court.teamB[0]);
  });
  const benchSet = new Set(benchIds);
  const inPool = (id: string): boolean => courtIndexById.has(id) || benchSet.has(id);

  let sum = 0;
  let targetCount = 0;
  for (const { a, b } of affinityPairs) {
    if (!inPool(a) || !inPool(b)) continue; // 両者ともこのラウンドの配置対象に現れないペアは対象外

    targetCount++;
    const courtA = courtIndexById.get(a);
    const courtB = courtIndexById.get(b);
    if (courtA === undefined || courtB === undefined || courtA !== courtB) {
      sum += 1.0; // 別コート、または片方以上がベンチ
    } else if (partnerOfId.get(a) === b) {
      sum += 0; // 味方
    } else {
      sum += 0.5; // 同コートで敵
    }
  }

  return targetCount === 0 ? 0 : clamp01(sum / targetCount);
}

/** 7目的すべてを計算した結果（各 0〜1） */
export type ObjectiveTerms = ObjectiveWeights;

export function computeObjectiveTerms(input: ObjectiveInput): ObjectiveTerms {
  return {
    fairness: computeFairness(input.courts, input.priorityRankById, input.candidateCount),
    waiting: computeWaiting(input.benchIds, input.priorityRankById, input.candidateCount),
    skillGap: computeSkillGap(input.courts, input.formRankById, input.rosterSize),
    competitive: computeCompetitive(input.courts, input.formRankById, input.rosterSize),
    gender: computeGender(input.courts, input.genderById, input.preferGenderMix),
    mixSplit: computeMixSplit(input.courts, input.genderById),
    variety: computeVariety(
      input.courts,
      input.pairCounts,
      input.pairKeyOf,
      input.reachableCountById
    ),
    affinity: computeAffinity(input.courts, input.benchIds, input.affinityPairs),
  };
}

/** 7項目を重み付き合計する（合計 = 目的関数値。小さいほど良い） */
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
    terms.variety * weights.variety +
    terms.affinity * weights.affinity
  );
}

/** 入力から目的関数値（重み付き合計）を直接計算する */
export function evaluateObjective(
  input: ObjectiveInput,
  weights: ObjectiveWeights
): number {
  return weightedObjective(computeObjectiveTerms(input), weights);
}
