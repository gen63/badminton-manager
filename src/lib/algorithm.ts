import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError } from './errorHandler';

type RatingGroup = 'upper' | 'middle' | 'lower';

// 配置確率（2コート）
const COURT_PROBABILITIES_2: Record<'upper' | 'lower', number[]> = {
  upper: [0.70, 0.30], // C1, C2
  lower: [0.30, 0.70],
};

// ===== 調整値（チューニング対象の定数はここに集約する）=====
//
// 優先度スコアは「低いほど先に出る」。ペナルティは全て `oneGameDelta`
// （= 1 試合分のスコア差）を単位にしており、「何試合分待たせてでも避けるか」で
// 強さを読める。強い順に: 性別3-1 / 同じ4人の繰り返し (3.0) > 実力差 (2.0) >
// MIX (0.5) > パートナー重複 (0.1) > 対戦相手重複 (0.05)。
// パートナー/対戦相手重複は selectBestFour の候補選出時点では6ペア分の
// 合計に掛かる（後述）ため、他のペナルティより小さめの重みでも十分効く。
// bench.ts で 0.5 や 1.0 も試したが、実力分離（序列差）の悪化が大きくなる
// 割に多様性の伸びが小さかったため、悪化がほぼ誤差範囲に収まる 0.1/0.05 を
// 採用している（docs/plans 等は無く、この場のチューニングで決定）。

/** 滞在時間の下限（分）。練習開始直後にスコアが極端にならないようにする */
const MIN_STAY_MINUTES = 5;
/** 滞在時間を使わないモードでの 1 試合あたりの素点 */
const GAMES_PLAYED_SCORE_UNIT = 0.4;
/** 性別 3-1 構成のペナルティ（制約でも弾かれるが、緩和時のために強め） */
const GENDER_UNBALANCED_PENALTY = 3.0;
/**
 * `roundGenderPairImpossible`（そのラウンドに限り2-2が作れない）のときの
 * 3-1ペナルティの倍率。`genderPairImpossible`（セッション全体で作れない）は
 * 完全無効化（倍率0扱い）だが、こちらは判定の確度が一段落ちる
 * （このラウンドの選出順序が違えば2-2にできた可能性がゼロではない）ため、
 * 完全に0にはせず弱める程度に留める。
 *
 * gbench_after.ts（18人3コート・200シード平均）で 0 / 0.2 / 0.35 / 0.5 / 1.0
 * を比較: 完全無効化（0）は試合数差を最も縮めるが3-1比率が現状
 * （少数派2人23.1%/3人23.4%）から23.5%前後まで増えてしまう。0.35 は
 * 試合数差を 0.59→0.42（少数派2人）/ 0.31→0.21（少数派3人）まで縮めつつ、
 * 3-1比率の増加を+0.3pt程度に抑えられる（別の独立シード集合で同じ設定を
 * 測ると変動幅だけで±0.5pt程度動くため、この程度は誤差の範囲内と判断した）。
 */
const GENDER_UNBALANCED_PENALTY_ROUND_SCALE = 0.35;
/** MIX（2-2）のペナルティ。同性 4-0 より優先度を落とすための軽い値 */
const GENDER_MIX_PENALTY = 0.5;
/** 同じ 4 人の組み合わせが繰り返されたときのペナルティ */
const COMBO_REPEAT_PENALTY = 3.0;
/** 同じ 4 人を許容する回数（これを超えるとペナルティ） */
const COMBO_REPEAT_ALLOWANCE = 2;
/**
 * パートナー重複ペナルティの重み。selectBestFour の時点ではまだペア分けが
 * 決まっていないため、4人から作れる全6ペアについて「過去にパートナーだった
 * 回数」の合計に対してこの重みを掛ける（近似）。
 */
const PARTNER_REPEAT_WEIGHT = 0.1;
/**
 * 対戦相手重複ペナルティの重み。考え方はパートナー重複と同じで、全6ペアの
 * 「過去に対戦相手だった回数」の合計に掛ける。パートナーより広く当たるため
 * （ペアを組む相手は2人だが対戦相手は4通りある）、重みは控えめにしている。
 */
const OPPONENT_REPEAT_WEIGHT = 0.05;
/**
 * パートナー/対戦相手重複ペナルティの上限（oneGameDelta 単位）。
 * 6ペア分の合計に重みを掛けるため、履歴が溜まる終盤には青天井に膨らみ、
 * 実力差ペナルティ（最大 2.0）と competing する規模になってしまう。
 * 上限を置くことで「同条件なら重複の少ない組を選ぶ」程度の役割に留める。
 *
 * 導入時は 0.3 だったが、21人3コートの実力分離（上位3×下位3が同じコートに
 * 入る割合、SEEDS=80）が 2.3% → 2.7% に悪化していた。0.3/0.2/0.15/0.1 を
 * 比較した結果、0.2 が上位3×下位3を 2.1%（元の 2.3% 相当まで回復）にしつつ、
 * パートナー多様性（reach.ts の近い実力同士の未共演率）も 31%（0.3 のときと
 * 同じ）を維持できたため 0.2 を採用した。0.15/0.1 はさらに分離を狙ったが
 * 上位3×下位3 が 2.2%/2.6% と逆に悪化し、未共演率も 33% に悪化したため見送った。
 */
const PAIR_REPEAT_PENALTY_CAP = 0.2;
/** 性別バランスで入れ替える際、待ち時間差がこの試合数未満なら入れ替えてよい */
const GENDER_SWAP_FAIRNESS_LIMIT = 2;
/** 平均よりこの試合数以上多い人は候補から外す（最大偏差制限） */
const MAX_GAMES_ABOVE_AVERAGE = 3;
/** 直近試合の重複判定で、各個人の何試合前まで遡るか */
const RECENT_MATCH_LOOKBACK = 3;
/** 直近試合と何人重複したら「似た試合」と見なすか */
const RECENT_MATCH_OVERLAP_LIMIT = 3;
/** 2 コート振り分けの確率に乗せるランダムノイズの幅（グループ間の行き来を作る） */
const COURT_ASSIGN_NOISE = 1.8;
/**
 * 3コート以上で、自グループの残り人数が4人に満たないコートが他グループから
 * 補充する際、不足数ちょうどではなく selectBestFour に多少の選択の余地を
 * 残すために上乗せする人数。大きすぎると探索コスト（候補数^4）が跳ね上がる。
 */
const RESCUE_CANDIDATE_BUFFER = 8;

/**
 * 練習後半の試合回数均等化 (lateBalanceMode) で使うコンテキスト。
 * 有効時、`maxGamesPlayed - p.gamesPlayed` の差分ペナルティを優先度スコアから
 * 減算する（差が大きい=試合数少ない人ほど優先される）。
 *
 * 重み 2.0 は selectBestFour の oneGameDelta 単位で、性別 3-1 ペナルティ (3.0) を
 * 2 試合以上の偏差で上回る程度。詳細は
 * `docs/plans/2026-05-19-balance-match-participation.md` 参照。
 */
type LateBalanceCtx = {
  enabled: boolean;
  maxGamesPlayed: number;
};
const LATE_BALANCE_WEIGHT = 2.0;

/**
 * 予約メンバーの試合数が「中央値 + この値」以上のとき予約全体を保留する。
 * 設定（SyncSettings.reservationBlockThreshold）未設定時のデフォルト。
 */
export const DEFAULT_RESERVATION_BLOCK_THRESHOLD = 2;

/**
 * 各プレイヤーの連勝/連敗数を算出
 * 正の値=連勝数、負の値=連敗数
 *
 * 入力 `matchHistory` は **古い順**（先頭が最も古い、末尾が最新）を前提とする。
 * `computeFinishAndContinue` 等が `[...prev, newMatch]` で末尾に追加するため、
 * production の matchHistory は常に古い順で並んでいる。
 */
export function getStreaks(matchHistory: Match[]): Map<string, number> {
  const streaks = new Map<string, number>();

  for (const match of matchHistory) {
    const winners = match.winner === 'A' ? match.teamA : match.teamB;
    const losers = match.winner === 'A' ? match.teamB : match.teamA;

    for (const id of winners) {
      const prev = streaks.get(id) ?? 0;
      streaks.set(id, prev > 0 ? prev + 1 : 1);
    }
    for (const id of losers) {
      const prev = streaks.get(id) ?? 0;
      streaks.set(id, prev < 0 ? prev - 1 : -1);
    }
  }

  return streaks;
}

/**
 * 初期序列を構築（レーティング降順、0はmiddleに挿入）
 */
export function buildInitialOrder(players: Player[]): string[] {
  const rated = players.filter(p => (p.rating ?? 0) > 0);
  const unrated = players.filter(p => (p.rating ?? 0) === 0);

  const sorted = [...rated].sort((a, b) => (b.rating ?? 1500) - (a.rating ?? 1500));

  if (unrated.length === 0) {
    return sorted.map(p => p.id);
  }

  // middleの開始位置に挿入
  const ratedIds = sorted.map(p => p.id);
  const middleStart = Math.floor(ratedIds.length / 3);
  const unratedIds = unrated.map(p => p.id);

  return [
    ...ratedIds.slice(0, middleStart),
    ...unratedIds,
    ...ratedIds.slice(middleStart),
  ];
}

/**
 * matchHistoryの勝敗に基づいて序列を動的に更新
 * - 勝利: 1つ上に移動
 * - 2連勝ごと: グループ1つ分上に移動
 * - 敗北: ceil(groupSize/2) 下に移動
 * groupCount: グループ数（3コート=3, 2コート=2）
 *
 * `matchHistory` は **古い順**（先頭が最も古い、末尾が最新）を前提とする。
 */
export function applyStreakSwaps(
  initialOrder: string[],
  matchHistory: Match[],
  groupCount: number = 3
): string[] {
  const order = [...initialOrder];
  const stepSize = Math.max(1, Math.floor(order.length / groupCount));
  const dropAmount = Math.max(1, Math.ceil(stepSize / 2));

  // 元の序列から離れてよい上限は 1 グループ分。連勝すれば隣のグループまで上がれる
  // が、それ以上は積み上がらない。無制限だと上位者が下位グループまで沈み、グループ
  // 内の実力幅が広がってしまう（18人3コートで 5 → 10.5）。
  const maxDrift = stepSize;
  const baseIndex = new Map(initialOrder.map((id, index) => [id, index]));
  const clampTarget = (id: string, target: number): number => {
    const base = baseIndex.get(id);
    if (base === undefined) return target;
    return Math.min(Math.max(target, base - maxDrift), base + maxDrift);
  };

  // 各プレイヤーの連勝カウント（処理中の累積）
  const streaks = new Map<string, number>();

  for (const match of matchHistory) {
    const winners = match.winner === 'A' ? match.teamA : match.teamB;
    const losers = match.winner === 'A' ? match.teamB : match.teamA;

    for (const id of winners) {
      const prev = streaks.get(id) ?? 0;
      const newStreak = prev > 0 ? prev + 1 : 1;
      streaks.set(id, newStreak);

      const idx = order.indexOf(id);
      if (idx === -1) continue;
      // 2連勝ごとにグループ1つ分上、それ以外の勝利は1つ上
      const rawTarget = newStreak >= 2 && newStreak % 2 === 0 ? idx - stepSize : idx - 1;
      const newIdx = Math.max(0, clampTarget(id, rawTarget));
      if (newIdx < idx) {
        order.splice(idx, 1);
        order.splice(newIdx, 0, id);
      }
    }

    // 敗北側: ceil(groupSize/2) 下に移動
    for (const id of losers) {
      streaks.set(id, 0);
      const idx = order.indexOf(id);
      if (idx === -1) continue;
      const newIdx = Math.min(order.length - 1, clampTarget(id, idx + dropAmount));
      if (newIdx > idx) {
        order.splice(idx, 1);
        order.splice(newIdx, 0, id);
      }
    }
  }

  return order;
}

/**
 * 序列からグループ分け（3コート用）
 * 3等分、端数は中位へ
 */
function groupPlayers3Court(
  players: Player[],
  matchHistory: Match[]
): Map<RatingGroup, Set<string>> {
  const initialOrder = buildInitialOrder(players);
  const order = applyStreakSwaps(initialOrder, matchHistory, 3);

  // アクティブプレイヤーのIDセット
  const activeIds = new Set(players.map(p => p.id));
  // 序列に含まれるアクティブプレイヤーのみ
  const activeOrder = order.filter(id => activeIds.has(id));

  const groupSize = Math.floor(activeOrder.length / 3);
  const remainder = activeOrder.length % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;

  const groups = new Map<RatingGroup, Set<string>>([
    ['upper', new Set()],
    ['middle', new Set()],
    ['lower', new Set()],
  ]);

  activeOrder.forEach((id, index) => {
    if (index < upperSize) {
      groups.get('upper')!.add(id);
    } else if (index < upperSize + middleSize) {
      groups.get('middle')!.add(id);
    } else {
      groups.get('lower')!.add(id);
    }
  });

  return groups;
}

/**
 * プレイヤーをストリーク調整済み序列でグループ分け（2コート用）
 * 2等分、端数は下位へ
 */
function groupPlayers2Court(
  players: Player[],
  matchHistory: Match[]
): Map<'upper' | 'lower', Set<string>> {
  const initialOrder = buildInitialOrder(players);
  const order = applyStreakSwaps(initialOrder, matchHistory, 2);

  const activeIds = new Set(players.map(p => p.id));
  const activeOrder = order.filter(id => activeIds.has(id));

  const upperSize = Math.floor(activeOrder.length / 2);

  const groups = new Map<'upper' | 'lower', Set<string>>([
    ['upper', new Set()],
    ['lower', new Set()],
  ]);

  activeOrder.forEach((id, index) => {
    if (index < upperSize) {
      groups.get('upper')!.add(id);
    } else {
      groups.get('lower')!.add(id);
    }
  });

  return groups;
}

/**
 * 候補4人それぞれの直近3試合と、4人中3人以上が重複するかチェック
 * グローバル直近N試合ではなく、各個人の視点で判定する
 *
 * `matchHistory` は **古い順**（末尾が最新）。末尾から走査して直近 3 試合を見る。
 */
function hasSimilarRecentMatch(
  fourPlayerIds: string[],
  matchHistory: Match[]
): boolean {
  for (const playerId of fourPlayerIds) {
    let found = 0;
    for (let i = matchHistory.length - 1; i >= 0; i--) {
      if (found >= RECENT_MATCH_LOOKBACK) break;
      const match = matchHistory[i];
      const matchMembers = [...match.teamA, ...match.teamB];
      if (!matchMembers.includes(playerId)) continue;
      found++;

      const overlap = fourPlayerIds.filter(id => matchMembers.includes(id));
      if (overlap.length >= RECENT_MATCH_OVERLAP_LIMIT) return true;
    }
  }
  return false;
}

/**
 * 上位と下位が同時にいる場合、どちらか1人だけはNG（3コート用）
 */
function hasIsolatedExtreme(
  memberIds: string[],
  groups: Map<RatingGroup, Set<string>>
): boolean {
  const upperCount = memberIds.filter(id => groups.get('upper')!.has(id)).length;
  const lowerCount = memberIds.filter(id => groups.get('lower')!.has(id)).length;
  
  if (upperCount > 0 && lowerCount > 0) {
    if ((upperCount === 1 && lowerCount >= 3) || (lowerCount === 1 && upperCount >= 3)) {
      return true;
    }
  }
  return false;
}

/**
 * 性別構成が不均衡（3-1構成）かどうかをチェック
 * 4人全員に性別が設定されている場合のみ判定
 */
function hasUnbalancedGender(
  playerIds: string[],
  players: Player[]
): boolean {
  const genders = playerIds
    .map(id => players.find(p => p.id === id)?.gender)
    .filter(g => g === 'M' || g === 'F');
  
  if (genders.length < 4) return false;  // 性別未設定がいる場合はOK
  
  const maleCount = genders.filter(g => g === 'M').length;
  return maleCount === 1 || maleCount === 3;  // 3-1構成ならNG
}

/**
 * 性別構成の偏りを許容すべきかを判定
 * 少数派性別が全体の30%未満の場合は3-1構成を許容する
 * 
 * @param allPlayers セッション全体のアクティブプレイヤー（判定基準、待機中でもプレイ中でも）
 * @param courtCount 今回配置するコート数
 */
function shouldAllowUnbalancedGender(
  allPlayers: Player[],
  courtCount: number
): boolean {
  const totalPlayers = allPlayers.length;
  const playersNeeded = courtCount * 4;
  
  // 性別が設定されているプレイヤーのみカウント
  const genderedPlayers = allPlayers.filter(p => p.gender === 'M' || p.gender === 'F');
  if (genderedPlayers.length < playersNeeded) {
    return true;  // 性別未設定が多い場合は許容
  }
  
  const maleCount = genderedPlayers.filter(p => p.gender === 'M').length;
  const femaleCount = genderedPlayers.filter(p => p.gender === 'F').length;
  
  // 少数派を特定
  const minorityCount = Math.min(maleCount, femaleCount);
  
  // 少数派が全体の30%未満なら3-1を許容
  const minorityRatio = minorityCount / totalPlayers;
  return minorityRatio < 0.30;
}

/**
 * 少数派性別が1人以下で、2-2構成が物理的に作れない状況かを判定
 *
 * `shouldAllowUnbalancedGender`（30%未満なら3-1をハード制約として許容）とは別の、
 * より狭い基準。少数派が2人以上いれば2-2は作れる可能性があり
 * （実測で少数派3人以上ならほぼ解消することを確認済み）、その場合まで
 * 3-1ソフトペナルティを無効化すると、待たせる効果自体を失って
 * 逆に3-1構成の試合が増えてしまう（男11女3構成で実測: 3-1比率が
 * 39.6%→54.2%に悪化）。少数派が1人だけ＝どう組んでも2-2にできない
 * 場合に限定することで、この副作用を避ける。
 *
 * **改善1・候補A**: この関数はセッション全体だけでなく、そのラウンドで
 * まだコートに割り振っていない人だけの集合（`normalCandidates.filter(p =>
 * !usedPlayers.has(p.id))`）に対しても呼び出す（呼び出し箇所は assignCourts の
 * 3コート以上ループ内、`roundGenderPairImpossible` を参照）。「対象の人数の中で
 * 少数派が何人か」という判定自体はセッション全体でもラウンド残りでも同じロジック
 * のため、関数はそのまま使い回せる。
 *
 * 3コート以上の動的グループ選択は `selectMostUrgentGroup` が待ち時間の長い
 * レーティング帯を1コートずつ選ぶため、少数派2人が同時に「空いている」とは
 * 限らない。片方が先のコートで既に使われてしまうと、そのラウンドの残りでは
 * 少数派が実質1人だけになり、どう組んでも2-2は作れないのに3-1ペナルティを
 * 課してしまい、結果的に少数派を待たせ続けることになる
 * （試合数差が縮まらない一因、実測で確認済み）。
 *
 * ラウンド残り単位で判定する点が重要: selectBestFour に渡す `candidates`
 * （隣接グループまで拡張した狭いプール）単位で判定すると、他のレーティング帯に
 * もう1人の少数派がまだ残っているのに「このプールだけ見ると1人」という
 * 誤検知で無効化してしまい、3-1が却って増える（実測で確認済み。18人少数派2人で
 * 3-1比率 23.3%→25.6%に悪化）。ラウンド単位に広げることでこの誤検知を避ける。
 *
 * ラウンド単位の判定は `preferGenderMix`（`isMinorityGenderScarce`）なセッション
 * に限定して使う想定。拮抗したセッションでは残り人数がたまたま少数派1人になっても
 * 単なる偶然であり、待たせる効果を弱める副作用の方が大きいため対象外とする。
 */
function isGenderPairImpossible(allPlayers: Player[]): boolean {
  const genderedPlayers = allPlayers.filter(p => p.gender === 'M' || p.gender === 'F');
  const maleCount = genderedPlayers.filter(p => p.gender === 'M').length;
  const femaleCount = genderedPlayers.length - maleCount;
  const minorityCount = Math.min(maleCount, femaleCount);
  return minorityCount === 1;
}

/**
 * 少数派性別が少ない（`shouldAllowUnbalancedGender` と同じ「全体の30%未満」）
 * セッションかどうかを判定。getGenderPenalty で MIX（2-2）を優遇するために使う。
 *
 * 背景: 少数派が少ないと、少数派2人を同じコートに集めて2-2を作ることが、
 * 3-1を作らずに少数派の出場機会を確保する唯一の道になる（男12女2 実測で
 * 女性の試合数が男性より0.8試合少なかった）。しかし現状は「同性4-0が常に
 * 最優先」のため、女性2人を同じコートに集めて2-2にする組み合わせ自体が
 * 男性だけの4-0よりペナルティで不利になり、抑制されてしまう。
 * 少数派が少ないときに限って2-2の優先度を4-0と同等まで引き上げることで、
 * 3-1を増やさずに女性の出場機会を増やす。
 *
 * `shouldAllowUnbalancedGender` と違い courtCount には依存しない
 * （こちらはハード制約ではなくソフトな優先度の話のため、コート数不足時の
 * フォールバックは考慮しない）。
 */
function isMinorityGenderScarce(allPlayers: Player[]): boolean {
  const genderedPlayers = allPlayers.filter(p => p.gender === 'M' || p.gender === 'F');
  if (genderedPlayers.length === 0) return false;

  const maleCount = genderedPlayers.filter(p => p.gender === 'M').length;
  const femaleCount = genderedPlayers.length - maleCount;
  const minorityCount = Math.min(maleCount, femaleCount);

  const minorityRatio = minorityCount / allPlayers.length;
  return minorityRatio < 0.30;
}

/**
 * `isMinorityGenderScarce` が true のセッションで、少数派側の性別を返す。
 * 同数（少数派なし）のときは null。3コート以上の動的グループ選択で、
 * 「このコートの候補に少数派がちょうど1人だけ含まれる（＝3-1になりかねない）」
 * かどうかを判定するために使う。
 */
function getScarceMinorityGender(allPlayers: Player[]): 'M' | 'F' | null {
  const genderedPlayers = allPlayers.filter(p => p.gender === 'M' || p.gender === 'F');
  const maleCount = genderedPlayers.filter(p => p.gender === 'M').length;
  const femaleCount = genderedPlayers.length - maleCount;
  if (maleCount === femaleCount) return null;
  return maleCount < femaleCount ? 'M' : 'F';
}

/**
 * ペアがMF（男女混合）かどうかを判定
 */
function isMixedPair(p1: Player, p2: Player): boolean {
  if (!p1.gender || !p2.gender) return false;
  return p1.gender !== p2.gender;
}

/**
 * 予約メンバーの性別構成に基づいて、補充候補を同性優先でソートする
 * candidatesはすでにpriority順にソート済みであること
 * 同性が不足する場合は異性で補充する（ソフトフィルター方式）
 */
function sortByGenderPreference(
  reservedPlayerIds: string[],
  candidates: Player[],
  allPlayers: Player[],
): Player[] {
  const reservedGenders = reservedPlayerIds
    .map(id => allPlayers.find(p => p.id === id)?.gender)
    .filter((g): g is 'M' | 'F' => g === 'M' || g === 'F');

  if (reservedGenders.length !== reservedPlayerIds.length) return candidates;

  const maleCount = reservedGenders.filter(g => g === 'M').length;
  const femaleCount = reservedGenders.filter(g => g === 'F').length;

  if (maleCount > 0 && femaleCount > 0) {
    // ミックス: 性別バランスを目指す
    if (maleCount === femaleCount) {
      // 同数（例: 1M+1F）→ 残り枠にM1+F1を優先配置
      const bestM = candidates.find(p => p.gender === 'M');
      const bestF = candidates.find(p => p.gender === 'F');
      if (bestM && bestF) {
        const others = candidates.filter(p => p.id !== bestM.id && p.id !== bestF.id);
        return [bestM, bestF, ...others];
      }
      return candidates;
    }
    // 不均衡（例: 2M+1F）→ 不足性別を優先
    const targetGender = maleCount > femaleCount ? 'F' : 'M';
    const preferred = candidates.filter(p => p.gender === targetGender);
    const others = candidates.filter(p => p.gender !== targetGender);
    return [...preferred, ...others];
  }

  // 同性のみ（男子 or 女子ダブルス）: 同性を優先
  const targetGender = maleCount > 0 ? 'M' : 'F';
  const sameGender = candidates.filter(p => p.gender === targetGender);
  const otherGender = candidates.filter(p => p.gender !== targetGender);
  return [...sameGender, ...otherGender];
}

/**
 * ペア分けのバランス崩れ許容幅（序列位置の合計差、単位=人）。
 * 4人の序列位置合計差が、最もバランスの良いペア分けよりこの幅を超えて
 * 悪化する候補は多様性ロジックの選択肢から外す。getSkillGapPenalty と同じ
 * 「人数の1/3（同一グループ相当の幅）」を流用している。
 */
const PAIRING_BALANCE_TOLERANCE_RATIO = 1 / 3;

/**
 * 4人を序列に基づいて2チームに編成する。
 *
 * 1+4位 vs 2+3位（最強+最弱ペア）が序列上最もバランスが良く、1+3位 vs 2+4位、
 * 1+2位 vs 3+4位の順にバランスが崩れる（sorted は序列順なので常にこの順）。
 * 2M+2Fの場合はMF vs MFになるよう既存ロジックでペアリングを調整し（優先）、
 * それ以外は matchHistory が渡されていれば、バランスを大きく崩さない範囲で
 * パートナー/対戦相手として過去に組んだ回数が最も少ないペア分けを選ぶ。
 * matchHistory 省略時（デフォルト = []）は常に 1+4 vs 2+3 を返す（従来の挙動）。
 *
 * `pairCounts` は matchHistory から集計済みの `buildHistoryCounts(...).pair` を
 * 渡すためのオプション引数。呼び出し元（assignCourts 等）がコート数ぶん
 * formTeams を呼ぶ際に、都度 matchHistory を全走査するのを避けられる。
 * 省略時は内部で従来どおり計算する。
 */
export function formTeams(
  fourPlayers: Player[],
  playerOrder: string[],
  matchHistory: Match[] = [],
  pairCounts?: PairHistoryCounts
): { teamA: [string, string]; teamB: [string, string] } {
  // 序列順にソート（playerOrder内の位置が若い = 上位）
  const sorted = [...fourPlayers].sort((a, b) => {
    const idxA = playerOrder.indexOf(a.id);
    const idxB = playerOrder.indexOf(b.id);
    // playerOrderに含まれない場合は末尾扱い
    return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB);
  });

  // 性別構成チェック: 全員性別設定済み && 2M+2F の場合のみMIXペアリング
  const genders = sorted.map(p => p.gender).filter(Boolean);
  const is2M2F = genders.length === 4 && genders.filter(g => g === 'M').length === 2;

  if (is2M2F) {
    // デフォルト（1+4 vs 2+3）がMFペアか確認
    const defaultIsMix = isMixedPair(sorted[0], sorted[3]) && isMixedPair(sorted[1], sorted[2]);
    if (defaultIsMix) {
      return {
        teamA: [sorted[0].id, sorted[3].id],
        teamB: [sorted[1].id, sorted[2].id],
      };
    }
    // 1+3 vs 2+4 を試す（1+2 vs 3+4 よりスキルバランスが良い）
    const altIsMix = isMixedPair(sorted[0], sorted[2]) && isMixedPair(sorted[1], sorted[3]);
    if (altIsMix) {
      return {
        teamA: [sorted[0].id, sorted[2].id],
        teamB: [sorted[1].id, sorted[3].id],
      };
    }
    // ここには到達しない: 2M+2Fなら sorted の性別並びは6通り
    // （MMFF/MFMF/MFFM/FMMF/FFMM/FMFM）しかなく、全パターンで default か alt の
    // いずれかが必ずMIXになる（数学的に証明済み）。万一に備えて安全側に
    // 下の多様性ロジックへフォールスルーさせる。
  }

  // 3通りのペア分け候補（バランス: 1+4/2+3 > 1+3/2+4 > 1+2/3+4 の順）
  const pairings: { teamA: [Player, Player]; teamB: [Player, Player] }[] = [
    { teamA: [sorted[0], sorted[3]], teamB: [sorted[1], sorted[2]] },
    { teamA: [sorted[0], sorted[2]], teamB: [sorted[1], sorted[3]] },
    { teamA: [sorted[0], sorted[1]], teamB: [sorted[2], sorted[3]] },
  ];

  if (matchHistory.length === 0) {
    // 履歴なし（省略時含む）→ 従来通りデフォルト（1+4 vs 2+3）
    const [p0, p3] = pairings[0].teamA;
    const [p1, p2] = pairings[0].teamB;
    return { teamA: [p0.id, p3.id], teamB: [p1.id, p2.id] };
  }

  // 序列上の位置（見つからない場合は playerOrder 全体より下位扱い）
  const positions = sorted.map(p => {
    const idx = playerOrder.indexOf(p.id);
    return idx === -1 ? playerOrder.length : idx;
  });
  const posOf = (p: Player): number => positions[sorted.indexOf(p)];

  const balanceGap = (pairing: (typeof pairings)[number]): number => {
    const sumA = posOf(pairing.teamA[0]) + posOf(pairing.teamA[1]);
    const sumB = posOf(pairing.teamB[0]) + posOf(pairing.teamB[1]);
    return Math.abs(sumA - sumB);
  };
  const gaps = pairings.map(balanceGap);
  const bestGap = gaps[0]; // 1+4 vs 2+3 が理論上最小

  // 「同一グループ相当」の幅までバランス悪化を許容する
  const allowance = Math.floor(playerOrder.length * PAIRING_BALANCE_TOLERANCE_RATIO);

  // 呼び出し元から渡されていなければ内部で集計する（従来どおりの挙動）
  const counts = pairCounts ?? buildHistoryCounts(matchHistory).pair;
  const repeatCount = (pairing: (typeof pairings)[number]): number => {
    const [a, b] = pairing.teamA;
    const [c, d] = pairing.teamB;
    const partner =
      (counts.partner.get(pairKey(a.id, b.id)) ?? 0) +
      (counts.partner.get(pairKey(c.id, d.id)) ?? 0);
    const opponent =
      (counts.opponent.get(pairKey(a.id, c.id)) ?? 0) +
      (counts.opponent.get(pairKey(a.id, d.id)) ?? 0) +
      (counts.opponent.get(pairKey(b.id, c.id)) ?? 0) +
      (counts.opponent.get(pairKey(b.id, d.id)) ?? 0);
    return partner + opponent;
  };

  let bestIndex = 0;
  let bestScore = repeatCount(pairings[0]);
  for (let i = 1; i < pairings.length; i++) {
    if (gaps[i] - bestGap > allowance) continue; // バランス悪化が許容超過なら除外
    const score = repeatCount(pairings[i]);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const chosen = pairings[bestIndex];
  return {
    teamA: [chosen.teamA[0].id, chosen.teamA[1].id],
    teamB: [chosen.teamB[0].id, chosen.teamB[1].id],
  };
}

/**
 * 2コート同時配置で、意図して少数派2人を同じコートにまとめた配置
 * （2-2 + 4-0）が、直後の repairCourtConstraints のコート間スワップによって
 * 「各コートに少数派が1人ずつ」（3-1 + 3-1）に戻されてしまっていないかを
 * 確認し、崩れていれば元の2-2 + 4-0に戻す修復を試みる（改善2）。
 *
 * 3コート以上の `repairLoneMinorityPairs` と同じ「既に決まった選出結果の間で
 * 少数派を入れ替えるだけ」というアプローチを2コート同時配置にも適用したもの。
 * `assign2CourtsHolistic` は選出直後に少数派2人を強制的に同じコートへまとめる
 * （下記 `finalMinorities.length >= 2` の分岐）が、その後に呼ぶ
 * `repairCourtConstraints`（直近試合の重複解消。旧 `tryFixRecentMatch`）は
 * 性別を考慮せず1人単位でコート間スワップするため、せっかくまとめた2-2を
 * 崩してしまうことがある（実測: 12人・少数派2人・2コートで20シード×16ラウンド
 * 中、直近試合修復適用後に208件中28件が2-2+4-0 → 1-1+1-1（3-1が2つ）に
 * 崩れていた）。
 *
 * **呼び出し順は repairCourtConstraints の後であること**。直近試合の重複回避は
 * 既存のハード制約寄りの挙動で、性別の2-2化は今回追加する補助的な修復。
 * 先に直近試合制約を解消させたうえで、その結果（`hasSimilarRecentMatch` で
 * 再チェック）を壊さない範囲でしか性別を直さない。逆順（性別修復を先に）にすると、
 * 性別修復で作った2-2を今度は repairCourtConstraints が直近試合解消のために
 * 再び1-1へ戻してしまい得るため、今回の対応が意味を失う。
 *
 * 3コート以上の版と同じく、実力差ガード（`getSkillGapPenalty` の入れ替え前後
 * 合計比較）も入れる。悪化する入れ替えはスキップし、元の（崩れた）組み合わせの
 * まま残す。
 */
function repairScatteredMinorityPair2Court(
  courtA: Player[],
  courtB: Player[],
  minorityGender: 'M' | 'F',
  matchHistory: Match[],
  baseRankById: Map<string, number>,
): void {
  // 両コートにちょうど1人ずつ散っている場合のみ修復対象
  if (courtA.filter(p => p.gender === minorityGender).length !== 1) return;
  const idxB = courtB.findIndex(p => p.gender === minorityGender);
  if (idxB === -1 || courtB.filter(p => p.gender === minorityGender).length !== 1) return;

  const originalSkillGap =
    getSkillGapPenalty(courtA.map(p => p.id), baseRankById, 1) +
    getSkillGapPenalty(courtB.map(p => p.id), baseRankById, 1);

  // courtB の少数派を courtA の多数派のいずれかと入れ替え、
  // courtA を2-2、courtB を4-0にする
  for (let i = 0; i < courtA.length; i++) {
    if (courtA[i].gender === minorityGender) continue; // 少数派同士は入れ替えない

    [courtA[i], courtB[idxB]] = [courtB[idxB], courtA[i]];
    const newAIds = courtA.map(p => p.id);
    const newBIds = courtB.map(p => p.id);

    const stillFixed = !hasSimilarRecentMatch(newAIds, matchHistory) &&
      !hasSimilarRecentMatch(newBIds, matchHistory);
    const newSkillGap =
      getSkillGapPenalty(newAIds, baseRankById, 1) + getSkillGapPenalty(newBIds, baseRankById, 1);

    if (stillFixed && newSkillGap <= originalSkillGap) {
      return; // 採用
    }
    [courtA[i], courtB[idxB]] = [courtB[idxB], courtA[i]]; // 元に戻す
  }
}

/**
 * 2コート同時配置（ホリスティック・アプローチ）
 * 優先スコア順で8人を選出 → 序列・確率ベースでC1/C2に振り分け
 * → 各個人の直近2試合で重複があればコート間スワップ → チーム編成
 */
function assign2CourtsHolistic(
  activePlayers: Player[],
  targetCourtIds: number[],
  matchHistory: Match[],
  practiceStartTime: number,
  groupingPlayers: Player[],
  useStayDuration: boolean = true,
  lateBalance?: LateBalanceCtx,
  genderPairImpossible: boolean = false,
  historyCounts?: HistoryCounts,
): CourtAssignment[] {
  // formTeams を2回（コートごとに）呼ぶため、集計済みなら使い回す
  const pairCounts = historyCounts?.pair;

  // 最大偏差制限: 平均より3試合以上多い人は除外
  const allGamesPlayed = activePlayers.map(p => p.gamesPlayed);
  const avgGames = allGamesPlayed.reduce((sum, g) => sum + g, 0) / allGamesPlayed.length;
  
  let eligiblePlayers = activePlayers.filter(
    p => p.gamesPlayed <= avgGames + MAX_GAMES_ABOVE_AVERAGE
  );
  
  // 除外しすぎた場合はフォールバック（必要人数を確保できない）
  const requiredCount = targetCourtIds.length * 4;
  if (eligiblePlayers.length < requiredCount) {
    eligiblePlayers = activePlayers;
  }
  
  // 1. 優先度順にソート
  const prioritySorted = [...eligiblePlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
    calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
  );

  // 2. 必要人数を選出（コート数 × 4人）
  // 性別バランスを考慮: 少数派性別が奇数人の場合、優先度最低の1人を多数派と入替
  let selected = prioritySorted.slice(0, requiredCount);

  // 全員に性別が設定されている場合のみ性別バランスを適用
  // genderPairImpossible（少数派1人で2-2が物理的に作れない構成）の場合、
  // 少数派を外しても待たせるだけで2-2は作れないためスキップする
  //
  // ここは「選出する8人を誰にするか」を決める段階であり、下の
  // repairScatteredMinorityPair2Court（改善2）は選出済みの8人を前提に
  // コート間で入れ替えるだけの後段の修復のため、互いに競合しない
  // （ここで少数派を偶数人に揃えておくことで、下のコート分けが
  // 少数派を過不足なく2人ずつまとめられる）。
  const allGendered = selected.every(p => p.gender === 'M' || p.gender === 'F');
  if (allGendered && !genderPairImpossible) {
    const femaleCount = selected.filter(p => p.gender === 'F').length;
    const maleCount = selected.filter(p => p.gender === 'M').length;
    // 少数派の性別を特定（同数の場合はバランス不要）
    const minorityGender: 'M' | 'F' | null =
      femaleCount < maleCount ? 'F' : maleCount < femaleCount ? 'M' : null;
    const minorityCount = minorityGender === 'F' ? femaleCount : minorityGender === 'M' ? maleCount : 0;

    if (minorityGender && minorityCount > 0 && minorityCount % 2 === 1) {
      // 奇数人の少数派がいる → 優先度が最も低い1人を除外候補に
      // ただし gamesPlayed === 0 は初回保証のため除外しない
      const minorities = selected.filter(p => p.gender === minorityGender);
      const excludable = minorities
        .filter(p => p.gamesPlayed > 0)
        .sort((a, b) =>
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance)
        );
      if (excludable.length > 0) {
        const toExclude = excludable[0];
        const majorityGender = minorityGender === 'F' ? 'M' : 'F';
        const nextMajority = prioritySorted
          .slice(requiredCount)
          .find(p => p.gender === majorityGender);
        if (nextMajority) {
          // フェアネスチェック: 除外候補が入替先より2試合分以上待っていたら除外しない
          const excludePriority = calculatePriorityScore(toExclude, practiceStartTime, useStayDuration, lateBalance);
          const replacePriority = calculatePriorityScore(nextMajority, practiceStartTime, useStayDuration, lateBalance);
          const oneGameDelta = computeOneGameDelta(practiceStartTime, useStayDuration);
          if (replacePriority - excludePriority < oneGameDelta * GENDER_SWAP_FAIRNESS_LIMIT) {
            selected = selected.filter(p => p.id !== toExclude.id);
            selected.push(nextMajority);
          }
        }
      }
    }
  }

  // 3. 全アクティブプレイヤーでグループ分け（グローバル序列）
  const groups = groupPlayers2Court(groupingPlayers, matchHistory);
  const upperIds = groups.get('upper')!;

  // 4. 選ばれたプレイヤーを序列順に並べ替え
  const initialOrder = buildInitialOrder(groupingPlayers);
  const order = applyStreakSwaps(initialOrder, matchHistory, 2);
  const orderedSelected = order
    .filter(id => selected.some(p => p.id === id))
    .map(id => selected.find(p => p.id === id)!);

  // 実力差ペナルティ用の序列（ハシゴ式で撹拌する前の、素の序列）。
  // repairCourtConstraints のスワップガードと repairScatteredMinorityPair2Court
  // の両方で使う。
  const baseRankById = new Map(initialOrder.map((id, index) => [id, index] as const));

  // 5. 確率ベースのコート振り分け（性別考慮あり）
  // 少数派の性別を同じコートにまとめてMIX配置を目指す
  const finalFemaleCount = orderedSelected.filter(p => p.gender === 'F').length;
  const finalMaleCount = orderedSelected.filter(p => p.gender === 'M').length;
  const finalAllGendered = orderedSelected.every(p => p.gender === 'M' || p.gender === 'F');
  // 少数派を特定（同数=4:4の場合はどちらでもMIXになるのでFを基準にグルーピング）
  const finalMinorityGender: 'M' | 'F' | null = !finalAllGendered ? null
    : finalFemaleCount <= finalMaleCount ? 'F' : 'M';
  const finalMinorities = finalMinorityGender
    ? orderedSelected.filter(p => p.gender === finalMinorityGender) : [];
  const finalMajorities = finalMinorityGender
    ? orderedSelected.filter(p => p.gender !== finalMinorityGender) : [];

  // 少数派が2人以上いる場合、同じコートにまとめる
  if (finalMinorityGender && finalMinorities.length >= 2) {
    // 少数派2人 + 多数派上位2人 をupperコートに配置
    const minoritiesForCourt = finalMinorities.slice(0, 2);
    const majoritiesForMixCourt = finalMajorities.slice(0, 2);
    const remainingMajorities = finalMajorities.slice(2);
    const remainingMinorities = finalMinorities.slice(2);

    const upperCourt = [...minoritiesForCourt, ...majoritiesForMixCourt];
    const lowerCourt = [...remainingMinorities, ...remainingMajorities];

    // 6. 直近試合制約のチェック・修正
    repairCourtConstraints([upperCourt, lowerCourt], matchHistory, baseRankById);

    // 6.5 直近試合スワップで意図した2-2配置が崩れていないか確認し、崩れて
    // いれば修復する（repairCourtConstraints より後に置く理由は関数コメント参照）
    repairScatteredMinorityPair2Court(upperCourt, lowerCourt, finalMinorityGender, matchHistory, baseRankById);

    // 7. コートID割り当て（小さいID = upperコート）
    const sortedCourtIds = [...targetCourtIds].sort((a, b) => a - b);

    // 8. チーム編成（序列ベースの最強+最弱ペアリング）
    const upperTeams = formTeams(upperCourt, order, matchHistory, pairCounts);
    const lowerTeams = formTeams(lowerCourt, order, matchHistory, pairCounts);

    return [
      { courtId: sortedCourtIds[0], teamA: upperTeams.teamA, teamB: upperTeams.teamB },
      { courtId: sortedCourtIds[1], teamA: lowerTeams.teamA, teamB: lowerTeams.teamB },
    ];
  }

  // 少数派が0-1人の場合: 従来通りの確率ベース振り分け
  // グループ確率 + ランダムノイズでスコアを付与し、上位4人をC1に配置
  // upper(70%) / lower(30%) の確率に基づきつつ、ランダム性で行き来が発生
  const courtScores = orderedSelected.map(player => {
    const isUpper = upperIds.has(player.id);
    const probC1 = isUpper
      ? COURT_PROBABILITIES_2.upper[0]   // 0.70
      : COURT_PROBABILITIES_2.lower[0];  // 0.30
    return {
      player,
      score: probC1 + Math.random() * COURT_ASSIGN_NOISE,
    };
  });
  courtScores.sort((a, b) => b.score - a.score);
  const upperCourt = courtScores.slice(0, 4).map(cs => cs.player);
  const lowerCourt = courtScores.slice(4).map(cs => cs.player);

  // 6. 直近試合制約のチェック・修正
  repairCourtConstraints([upperCourt, lowerCourt], matchHistory, baseRankById);

  // 7. コートID割り当て（小さいID = upperコート）
  const sortedCourtIds = [...targetCourtIds].sort((a, b) => a - b);

  // 8. チーム編成（序列ベースの最強+最弱ペアリング）
  const upperTeams = formTeams(upperCourt, order, matchHistory, pairCounts);
  const lowerTeams = formTeams(lowerCourt, order, matchHistory, pairCounts);

  return [
    { courtId: sortedCourtIds[0], teamA: upperTeams.teamA, teamB: upperTeams.teamB },
    { courtId: sortedCourtIds[1], teamA: lowerTeams.teamA, teamB: lowerTeams.teamB },
  ];
}

/**
 * 「1 試合分」に相当する優先度スコアの差。各ペナルティの単位として使う。
 *
 * 滞在時間ベースのときは `calculatePriorityScore` の 1 試合分と正確に一致する。
 * 滞在時間を使わないモードでは素点が `GAMES_PLAYED_SCORE_UNIT`(0.4) 刻みなので、
 * ここで返す 1.0 は 2.5 試合分に相当する（＝ペナルティが相対的に強く効く）。
 * 既存の挙動なのでそのままにしてあるが、調整するならこの差を踏まえること。
 */
function computeOneGameDelta(
  practiceStartTime: number,
  useStayDuration: boolean
): number {
  if (!useStayDuration) return 1.0;
  return 1 / Math.max((Date.now() - practiceStartTime) / (1000 * 60), MIN_STAY_MINUTES);
}

/**
 * 滞在時間ベースの優先度を計算
 * 優先スコア = 試合回数 / max(滞在時間(分), 5)
 * スコアが低い人を優先
 *
 * lateBalance が有効なとき、`(maxGamesPlayed - gamesPlayed) * 重み * oneGameDelta`
 * を減算して試合数の少ない人を強く優先する。
 */
function calculatePriorityScore(
  player: Player,
  practiceStartTime: number,
  useStayDuration: boolean = true,
  lateBalance?: LateBalanceCtx,
): number {
  // まだ1回も試合してない人は最優先（1回保証）
  if (player.gamesPlayed === 0) {
    return -Infinity;
  }

  let baseScore: number;
  if (!useStayDuration) {
    baseScore = player.gamesPlayed * GAMES_PLAYED_SCORE_UNIT;
  } else {
    const now = Date.now();
    // 滞在開始時刻 = max(練習開始日時, 休憩解除時刻)
    const stayStart = Math.max(practiceStartTime, player.activatedAt ?? now);
    // 滞在時間（分）、最低5分
    const stayMinutes = Math.max((now - stayStart) / (1000 * 60), MIN_STAY_MINUTES);
    baseScore = player.gamesPlayed / stayMinutes;
  }

  if (lateBalance?.enabled) {
    const gap = lateBalance.maxGamesPlayed - player.gamesPlayed;
    if (gap > 0) {
      const oneGameDelta = computeOneGameDelta(practiceStartTime, useStayDuration);
      baseScore -= gap * LATE_BALANCE_WEIGHT * oneGameDelta;
    }
  }

  return baseScore;
}

/**
 * 4人の性別構成に基づくペナルティを計算
 * 4人全員に性別が設定されている場合のみ有効
 * 2-2（MIX）or 4-0（同性）→ 0、3-1 → ペナルティ
 *
 * @param genderPairImpossible `isGenderPairImpossible` の判定結果。少数派性別が
 *   1人だけで 2-2 構成が物理的に作れない場合に true。
 *   この場合、少数派を含む組は必ず 3-1 になるため、3-1 ペナルティを課しても
 *   バランスは改善せず、少数派の出場機会を待たせるだけになる → ペナルティを無効化する。
 *   少数派が2人以上いる（＝2-2が作れる余地がある）場合はここには該当せず、
 *   従来どおりペナルティを効かせて2-2/4-0へ誘導する。
 * @param preferGenderMix `isMinorityGenderScarce` の判定結果。少数派性別が
 *   全体の30%未満のセッションで true。この場合、MIX（2-2）ペナルティを
 *   同性（4-0）と同じ0にする。少数派2人を同じコートに集めて2-2を作ることが
 *   3-1を増やさずに少数派の出場機会を確保する唯一の手段のため、通常時のような
 *   「同性を必ず2-2より優先」を止め、優先度（待ち時間）どおりの選出に委ねる。
 *   男女が拮抗するセッション（30%以上）では従来どおり同性を優先する。
 * @param roundGenderPairImpossible `genderPairImpossible` をセッション全体では
 *   なく「そのラウンドで未使用の人だけ」に一般化した判定結果（改善1・候補A）。
 *   `genderPairImpossible` ほど確実ではない（同ラウンドの他コートの選出順序に
 *   よっては、もし違う順番で選んでいれば2-2にできた可能性がゼロではない）ため、
 *   完全無効化ではなく `GENDER_UNBALANCED_PENALTY_ROUND_SCALE` で弱めた
 *   ペナルティに留める。完全無効化すると3-1の割合が現状より増えてしまうことを
 *   実測で確認したための調整（18人少数派2人で3-1比率 23.1%→23.5%に悪化）。
 */
function getGenderPenalty(
  combo: Player[],
  oneGameDelta: number,
  genderPairImpossible: boolean = false,
  preferGenderMix: boolean = false,
  roundGenderPairImpossible: boolean = false,
): number {
  const genders = combo.map(p => p.gender).filter(Boolean);
  if (genders.length < 4) return 0; // 性別未設定がいる場合は影響なし

  const maleCount = genders.filter(g => g === 'M').length;

  // 優先順位: 同性（4-0） > MIX（2-2） > 3-1
  // ただし preferGenderMix のときは 同性（4-0） = MIX（2-2） とする

  // 3-1構成 → 強ペナルティ（制約でも弾かれる）
  // ただし genderPairImpossible（少数派1人で2-2が作れない構成）の場合は無効化。
  // roundGenderPairImpossible（そのラウンドに限り作れない）の場合は、完全無効化
  // ではなく弱めたペナルティを課す
  if (maleCount === 1 || maleCount === 3) {
    if (genderPairImpossible) return 0;
    if (roundGenderPairImpossible) {
      return oneGameDelta * GENDER_UNBALANCED_PENALTY * GENDER_UNBALANCED_PENALTY_ROUND_SCALE;
    }
    return oneGameDelta * GENDER_UNBALANCED_PENALTY;
  }

  // MIX（2-2）→ 軽いペナルティ（同性より優先度低め）。ただし少数派が少ないときは
  // 同性と同格にし、待ち時間優先で少数派2人が組める機会を確保する
  if (maleCount === 2) {
    return preferGenderMix ? 0 : oneGameDelta * GENDER_MIX_PENALTY;
  }

  // 同性（4-0 or 0-4）→ ペナルティなし（最優先）
  return 0;
}

/** 実力差ペナルティの重み（1試合分のスコア差 = oneGameDelta の何倍か） */
const SKILL_GAP_WEIGHT = 2.0;
/** この人数未満のセッションでは実力差を考慮しない（選択の余地が無く、混ざって当然） */
const MIN_ROSTER_FOR_SKILL_GAP = 12;

/**
 * 実力が離れすぎた 4 人が同じコートに入るのを避けるためのペナルティ。
 *
 * 判定には**ハシゴ式（applyStreakSwaps）適用前の序列**を使う。ハシゴ式はコート
 * 固定化を防ぐための回転装置で序列を撹拌するため、撹拌後の upper/lower で実力を
 * 判定しても分離にならないため。
 *
 * ハード制約ではなくスコアへの加算（ソフト）にしているのは、候補が少ないときに
 * 自動的に緩んでほしいから。少人数セッションでは `MIN_ROSTER_FOR_SKILL_GAP` 未満で
 * 無効になり、許容幅も人数に比例するので、人数が少ないほど緩くなる。
 */
function getSkillGapPenalty(
  comboIds: string[],
  baseRankById: Map<string, number>,
  oneGameDelta: number
): number {
  const rosterSize = baseRankById.size;
  if (rosterSize < MIN_ROSTER_FOR_SKILL_GAP) return 0;

  const ranks: number[] = [];
  for (const id of comboIds) {
    const rank = baseRankById.get(id);
    if (rank === undefined) return 0; // 序列に載っていない人がいたら判定しない
    ranks.push(rank);
  }

  const gap = Math.max(...ranks) - Math.min(...ranks);
  // 同じグループ相当（人数の 1/3）の幅までは許容する
  const allowance = Math.floor(rosterSize / 3);
  if (gap <= allowance) return 0;

  // 超過分を 0-1 に正規化。全体幅いっぱいに離れているときが最大ペナルティ。
  const excess = (gap - allowance) / Math.max(1, rosterSize - 1 - allowance);
  return oneGameDelta * SKILL_GAP_WEIGHT * excess;
}

/**
 * セッション通算で同じ4人の組み合わせが繰り返される場合のペナルティ
 * 2回目までは許容、3回目以降は強いペナルティを加算
 *
 * `comboCounts` は `buildHistoryCounts` で事前集計した「4人組み合わせキー →
 * 出現回数」の Map。selectBestFour の候補探索（4重ループ）の中で毎回
 * matchHistory を全走査すると重くなるため、外側で1回だけ集計した結果を渡す。
 */
function getComboRepeatPenalty(
  comboIds: string[],
  comboCounts: Map<string, number>,
  oneGameDelta: number
): number {
  const count = comboCounts.get(comboKey(comboIds)) ?? 0;
  // 3回目以降を強く回避（2回までは許容）
  return count >= COMBO_REPEAT_ALLOWANCE ? oneGameDelta * COMBO_REPEAT_PENALTY : 0;
}

/** 2人1組のペアキー（順序に依らず一意） */
function pairKey(id1: string, id2: string): string {
  return [id1, id2].sort().join(',');
}

/** 4人1組の組み合わせキー（順序に依らず一意） */
function comboKey(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}

/** 2人の組み合わせごとの「パートナーだった回数」「対戦相手だった回数」の集計結果 */
interface PairHistoryCounts {
  partner: Map<string, number>;
  opponent: Map<string, number>;
}

/**
 * matchHistory から集計した結果一式。パートナー/対戦相手重複ペナルティ
 * （`getPairRepeatPenalty`）と、同一4人組み合わせ重複ペナルティ
 * （`getComboRepeatPenalty`）の両方で使う。
 */
interface HistoryCounts {
  pair: PairHistoryCounts;
  combo: Map<string, number>;
}

/**
 * matchHistory 全体を1回走査し、
 * - 任意の2人がパートナー/対戦相手だった回数（ペアごと）
 * - 同じ4人の組み合わせが出現した回数
 * をまとめて集計する。selectBestFour の候補組み合わせ探索（4重ループ、さらに
 * 借用の段階拡大ループで最大 n 回呼ばれる）や formTeams のペア分け判定で
 * 毎回 matchHistory を全走査すると重くなるため、assignCourts 側で1回だけ
 * 計算し、各所に使い回す。
 */
function buildHistoryCounts(matchHistory: Match[]): HistoryCounts {
  const partner = new Map<string, number>();
  const opponent = new Map<string, number>();
  const combo = new Map<string, number>();
  const bump = (map: Map<string, number>, id1: string, id2: string) => {
    if (!id1 || !id2) return; // シングルス等で空文字が入るケースを無視
    const key = pairKey(id1, id2);
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const match of matchHistory) {
    const [a1, a2] = match.teamA;
    const [b1, b2] = match.teamB;
    bump(partner, a1, a2);
    bump(partner, b1, b2);
    bump(opponent, a1, b1);
    bump(opponent, a1, b2);
    bump(opponent, a2, b1);
    bump(opponent, a2, b2);

    const key = comboKey([a1, a2, b1, b2]);
    combo.set(key, (combo.get(key) ?? 0) + 1);
  }
  return { pair: { partner, opponent }, combo };
}

/**
 * パートナー重複・対戦相手重複のペナルティ（近似）
 * selectBestFour の時点ではまだペア分けが決まっていないため、4人から作れる
 * 全6ペアについて、過去にパートナーだった回数の合計と対戦相手だった回数の
 * 合計をそれぞれ求め、重みを掛けて加算する。
 */
function getPairRepeatPenalty(
  comboIds: string[],
  pairCounts: PairHistoryCounts,
  oneGameDelta: number
): number {
  let partnerTotal = 0;
  let opponentTotal = 0;
  for (let i = 0; i < comboIds.length; i++) {
    for (let j = i + 1; j < comboIds.length; j++) {
      const key = pairKey(comboIds[i], comboIds[j]);
      partnerTotal += pairCounts.partner.get(key) ?? 0;
      opponentTotal += pairCounts.opponent.get(key) ?? 0;
    }
  }
  const raw = PARTNER_REPEAT_WEIGHT * partnerTotal + OPPONENT_REPEAT_WEIGHT * opponentTotal;
  return oneGameDelta * Math.min(raw, PAIR_REPEAT_PENALTY_CAP);
}

/**
 * グループごとの平均優先度スコアを計算し、最も待っているグループを特定する
 */
function calculateGroupPriorities(
  groups: Map<RatingGroup, Set<string>>,
  players: Player[],
  usedPlayerIds: Set<string>,
  practiceStartTime: number,
  useStayDuration: boolean,
  lateBalance?: LateBalanceCtx,
): Map<RatingGroup, number> {
  const priorities = new Map<RatingGroup, number>();
  
  for (const [groupName, memberIds] of groups) {
    const availableMembers = players.filter(
      p => memberIds.has(p.id) && !usedPlayerIds.has(p.id)
    );
    
    if (availableMembers.length === 0) {
      priorities.set(groupName, Infinity); // 空グループは除外
      continue;
    }
    
    // グループの平均優先度スコアを計算（低いほど待っている）
    const avgScore = availableMembers.reduce(
      (sum, p) => sum + calculatePriorityScore(p, practiceStartTime, useStayDuration, lateBalance),
      0
    ) / availableMembers.length;
    
    priorities.set(groupName, avgScore);
  }
  
  return priorities;
}

/**
 * 最も待っているグループを選択する
 * 最大偏差制限も考慮：あるグループが他より3試合以上多い場合は除外
 */
function selectMostUrgentGroup(
  groups: Map<RatingGroup, Set<string>>,
  players: Player[],
  usedPlayerIds: Set<string>,
  practiceStartTime: number,
  useStayDuration: boolean,
  lateBalance?: LateBalanceCtx,
): RatingGroup | null {
  const priorities = calculateGroupPriorities(
    groups, players, usedPlayerIds, practiceStartTime, useStayDuration, lateBalance
  );
  
  // 全員のgamesPlayedから平均を計算
  const allGamesPlayed = players.map(p => p.gamesPlayed);
  const avgGames = allGamesPlayed.reduce((sum, g) => sum + g, 0) / allGamesPlayed.length;
  
  // 最も優先度の高い（スコアが低い）グループを選択
  let bestGroup: RatingGroup | null = null;
  let bestScore = Infinity;
  
  for (const [groupName, score] of priorities) {
    if (score === Infinity) continue; // 空グループはスキップ
    
    // このグループの平均試合回数を計算
    const groupMembers = players.filter(
      p => groups.get(groupName)!.has(p.id) && !usedPlayerIds.has(p.id)
    );
    const groupAvgGames = groupMembers.reduce((sum, p) => sum + p.gamesPlayed, 0) / groupMembers.length;
    
    // 最大偏差制限：平均より3試合以上多いグループは除外
    if (groupAvgGames > avgGames + MAX_GAMES_ABOVE_AVERAGE) {
      continue;
    }
    
    if (score < bestScore) {
      bestScore = score;
      bestGroup = groupName;
    }
  }
  
  return bestGroup;
}

/**
 * 候補から制約を満たす最適な4人の組み合わせを探索
 * グリーディではなく全組み合わせを探索し、優先スコア合計が最小の有効な組を返す
 * 有効な組が見つからない場合は制約を緩和して上位4人を返す
 */
function selectBestFour(
  candidates: Player[],
  matchHistory: Match[],
  groups3: Map<RatingGroup, Set<string>> | null,
  totalCourtCount: number,
  practiceStartTime: number,
  useStayDuration: boolean,
  allowUnbalanced?: boolean,
  lateBalance?: LateBalanceCtx,
  baseRankById?: Map<string, number>,
  genderPairImpossible?: boolean,
  preferGenderMix?: boolean,
  historyCounts?: HistoryCounts,
  roundGenderPairImpossible?: boolean,
): Player[] {
  if (candidates.length <= 4) return candidates;

  // candidatesは優先スコア昇順でソート済みの前提
  const isValid = (ids: string[]): boolean => {
    if (hasSimilarRecentMatch(ids, matchHistory)) return false;
    if (totalCourtCount >= 3 && groups3 && hasIsolatedExtreme(ids, groups3)) return false;
    if (!allowUnbalanced && hasUnbalancedGender(ids, candidates)) return false;  // 性別構成チェック（条件付き）
    return true;
  };

  const playerScore = (p: Player): number => {
    const base = calculatePriorityScore(p, practiceStartTime, useStayDuration, lateBalance);
    if (base === -Infinity) return -1e9; // 有限値にして複数の未プレイ者を含む組の比較を可能にする
    return base;
  };

  // 性別ペナルティ用の基準値（1試合分のスコア差）
  const oneGameDelta = computeOneGameDelta(practiceStartTime, useStayDuration);

  // パートナー/対戦相手重複・同一4人組み合わせ重複ペナルティ用に、matchHistory
  // 全体を1回だけ集計（4重ループの中で毎回 matchHistory を走査すると重くなるため）。
  // 呼び出し元（assignCourts）が既に集計済みなら渡してもらい、再集計を避ける。
  const counts = historyCounts ?? buildHistoryCounts(matchHistory);

  let bestCombo: Player[] | null = null;
  let bestScore = Infinity;

  const n = candidates.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const combo = [candidates[i], candidates[j], candidates[k], candidates[l]];
          const ids = combo.map(p => p.id);
          if (!isValid(ids)) continue;

          const s = combo.reduce((sum, p) => sum + playerScore(p), 0)
            + getGenderPenalty(combo, oneGameDelta, genderPairImpossible, preferGenderMix, roundGenderPairImpossible)
            + getComboRepeatPenalty(ids, counts.combo, oneGameDelta)
            + getPairRepeatPenalty(ids, counts.pair, oneGameDelta)
            + (baseRankById ? getSkillGapPenalty(ids, baseRankById, oneGameDelta) : 0);

          if (s < bestScore) {
            bestScore = s;
            bestCombo = combo;
          }
        }
      }
    }
  }

  // 有効な組み合わせが見つからない場合は制約緩和（上位4人）
  return bestCombo ?? candidates.slice(0, 4);
}

/**
 * 各コートの選出結果を横断的に見て、直近試合の重複・上下孤立・性別ハード制約
 * （3-1構成が許されないセッションでの3-1）のいずれかに違反したまま残っている
 * コートがあれば、他コートとの1人スワップで解消を試みる。
 *
 * 2コート・3コート以上の両方から使う共通の後始末処理（旧 `tryFixRecentMatch`
 * の2コート限定版と、3コート以上向けに新設した処理を統合したもの）。
 * `groups3`・`allowUnbalanced`・`candidatePoolForGenderCheck` は3コート以上
 * でのみ渡す（上下孤立判定・3-1ハード制約は3グループ構成が前提のため）。
 * 2コートからは省略して呼び、直近試合の重複解消だけを行う（旧
 * `tryFixRecentMatch` と同じ振る舞い）。
 *
 * 3コート以上では、各コートの候補を自分のレーティング帯だけに限定する（隣接
 * グループから事前に借用しない）ことで「先に処理されたコートが後のコートの分
 * まで候補を先取りする」逐次貪欲を避けられる一方、グループ内だけでは制約を
 * 満たせない選出がまれに残る。ここではその後始末として、既に決まった選出
 * 同士でメンバーを交換し、実力差を悪化させない範囲で違反を解消する。
 * `repairLoneMinorityPairs`（性別の少数派分散に特化した修復）とは別の、
 * より一般的な違反種別を扱う修復で、この関数の後に呼ぶ想定
 * （そちらは preferGenderMix セッションに限定した性別専用の後処理のため）。
 *
 * 入れ替えは、両コートの制約が解消し、かつ `getSkillGapPenalty`（素の序列
 * `baseRankById` を使う実力差ペナルティ本体）の2コート合計が悪化しない場合
 * のみ採用する。解消できないコートはそのまま残す（違反ありの組み合わせに
 * なるが、これは元々の逐次探索でも制約緩和時に起こり得た挙動と同じ）。
 */
function repairCourtConstraints(
  courts: Player[][],
  matchHistory: Match[],
  baseRankById: Map<string, number>,
  options?: {
    groups3?: Map<RatingGroup, Set<string>>;
    allowUnbalanced?: boolean;
    candidatePoolForGenderCheck?: Player[];
  },
): void {
  const isViolating = (ids: string[]): boolean =>
    hasSimilarRecentMatch(ids, matchHistory) ||
    (!!options?.groups3 && hasIsolatedExtreme(ids, options.groups3)) ||
    (!options?.allowUnbalanced && !!options?.candidatePoolForGenderCheck &&
      hasUnbalancedGender(ids, options.candidatePoolForGenderCheck));

  // 実力差ガードは3コート以上（options 指定あり）のときだけ効かせる。2コートの
  // 直近試合修復（旧 tryFixRecentMatch）はこのガードを持たなかったため、ここで
  // 追加すると「修復できたはずのスワップが実力差悪化を理由に見送られ、結果的に
  // 別のスワップ（性別バランスを崩すもの等）に流れてしまう」形で2コートの
  // 性別バランスに副作用が出る（実測で確認済み）。3コート以上は元々
  // `getSkillGapPenalty` を選出時にも使っており、ガードを効かせても整合する。
  const enforceSkillGapGuard = !!options;
  const skillGapOf = (ids: string[]): number => getSkillGapPenalty(ids, baseRankById, 1);

  for (let ci = 0; ci < courts.length; ci++) {
    const court = courts[ci];
    if (!isViolating(court.map(p => p.id))) continue;

    let fixedThisCourt = false;
    for (let cj = 0; cj < courts.length && !fixedThisCourt; cj++) {
      if (cj === ci) continue;
      const other = courts[cj];
      const originalGap =
        skillGapOf(court.map(p => p.id)) + skillGapOf(other.map(p => p.id));

      // court 側は末尾（序列的に境界に近い人）から試す。2コートの少数派まとめ
      // （assign2CourtsHolistic）はコート配列の先頭に意図した性別ペアを置くため、
      // 先頭から総当たりすると直近試合の修復のたびにその意図を壊しやすい
      // （旧 tryFixRecentMatch も同じ理由で末尾から試していた）。
      for (let i = court.length - 1; i >= 0 && !fixedThisCourt; i--) {
        for (let j = 0; j < other.length; j++) {
          [court[i], other[j]] = [other[j], court[i]];
          const newCourtIds = court.map(p => p.id);
          const newOtherIds = other.map(p => p.id);
          const newGap = skillGapOf(newCourtIds) + skillGapOf(newOtherIds);
          const gapOk = !enforceSkillGapGuard || newGap <= originalGap;

          if (!isViolating(newCourtIds) && !isViolating(newOtherIds) && gapOk) {
            fixedThisCourt = true;
            break;
          }
          [court[i], other[j]] = [other[j], court[i]]; // 元に戻す
        }
      }
    }
  }
}

/**
 * 少数派性別が少ないセッション（3コート以上）で、このラウンドの各コートの
 * 選出結果を見て、少数派がちょうど1人だけの（3-1になりかねない）コートが
 * 2つ以上あれば、少数派同士を同じコートにまとめられないか修復を試みる。
 *
 * `selectMostUrgentGroup` によるコートの逐次的なグループ選択は、各コートが
 * 自分のレーティング帯の候補プールしか見ないため、2人の少数派が別々のコートの
 * 候補プールに分かれてしまい、それぞれ3-1になってしまうことがある
 * （実測: 男12女2/3コートで、2つのコートにそれぞれ少数派が1人ずつ配置され
 * 両方3-1になるケースが発生していた）。
 *
 * ここでは「誰を選ぶか」を変えるのではなく、既に決まった選出結果の間で
 * 少数派を入れ替えるだけなので、参加人数・総試合数は変わらない
 * （2つの3-1 → 1つの2-2 + 1つの4-0 になるだけ）。少数派2人が2-2の
 * ためだけに毎ラウンド前倒しで選ばれるような過矯正を避けられる
 * （実際に試したところ、選出そのものを変える方式は少数派の試合数が
 * 逆に多数派を上回るほど過矯正になった）。
 *
 * 入れ替えは直近対戦・実力差の制約を満たす場合のみ行う。満たさなければ
 * そのコートの組み合わせには手を付けない。
 *
 * 実力差ガード: `hasIsolatedExtreme` は「上位1人＋下位3人」のような極端な
 * 孤立しか弾かないため、コート間スワップで実力帯をまたいでも素通りしてしまう
 * （実測: 少数派3人・18人3コートで上位3×下位3が 7.7%→8.9% に悪化）。
 * そこで `getSkillGapPenalty`（ハシゴ式適用前の素の序列 `baseRankById` を
 * 使う、実力差ペナルティ本体）で入れ替え前後の2コート合計を比較し、
 * 悪化するスワップ候補はスキップする。全候補が悪化する場合は修復せず
 * 元の組み合わせのまま残す（3-1のままにする）。
 */
function repairLoneMinorityPairs(
  courtSelections: { courtId: number; selected: Player[] }[],
  minorityGender: 'M' | 'F',
  matchHistory: Match[],
  groups3: Map<RatingGroup, Set<string>>,
  baseRankById: Map<string, number>,
): void {
  const loneMinorityCourts = courtSelections.filter(
    c => c.selected.filter(p => p.gender === minorityGender).length === 1
  );
  if (loneMinorityCourts.length < 2) return;

  // このコートの直近数試合のいずれかと完全に同じ4人か（＝入れ替え直後にすぐ
  // 同じ顔ぶれを再現してしまわないか）を見る、修復専用の軽い直近判定。
  // hasSimilarRecentMatch（3人以上の重複=無効）をここでも使うと、少数派2人は
  // 母数が少ないセッションでは短期間に多くの人と対戦済みになりやすく、
  // ほぼ常にどの入れ替えも弾かれてしまう（実測: 男12女2で1件も修復できず）。
  // 入れ替えは「既に決定した8人の中で誰と誰を組ませるか」を変えるだけの
  // 補助的な修復なので、完全に同じ4人の再現だけを避ければ十分と判断した。
  const REPAIR_RECENT_LOOKBACK = 6;
  const isExactRecentRepeat = (ids: string[]): boolean => {
    const key = [...ids].sort().join(',');
    return matchHistory.slice(-REPAIR_RECENT_LOOKBACK).some(
      m => [...m.teamA, ...m.teamB].sort().join(',') === key
    );
  };

  // getSkillGapPenalty は oneGameDelta を掛けた値を返すが、ここでは前後の
  // 大小比較にしか使わないので、正の定数（1）を渡せば十分（比較の単調性は
  // oneGameDelta の値に依存しない）。
  const skillGapOf = (ids: string[]): number => getSkillGapPenalty(ids, baseRankById, 1);

  for (let i = 0; i + 1 < loneMinorityCourts.length; i += 2) {
    const courtA = loneMinorityCourts[i];
    const courtB = loneMinorityCourts[i + 1];
    const minorityA = courtA.selected.find(p => p.gender === minorityGender)!;
    const minorityB = courtB.selected.find(p => p.gender === minorityGender)!;
    const majorityInA = courtA.selected.filter(p => p.id !== minorityA.id);

    const originalSkillGap =
      skillGapOf(courtA.selected.map(p => p.id)) + skillGapOf(courtB.selected.map(p => p.id));

    // courtA の多数派のうち1人を courtB の少数派と入れ替え、
    // courtA を2-2（少数派2人）、courtB を4-0（多数派のみ）にする
    for (const swapOut of majorityInA) {
      const newA = [...courtA.selected.filter(p => p.id !== swapOut.id), minorityB];
      const newB = [...courtB.selected.filter(p => p.id !== minorityB.id), swapOut];
      const newAIds = newA.map(p => p.id);
      const newBIds = newB.map(p => p.id);

      if (isExactRecentRepeat(newAIds)) continue;
      if (isExactRecentRepeat(newBIds)) continue;
      if (hasIsolatedExtreme(newAIds, groups3)) continue;
      if (hasIsolatedExtreme(newBIds, groups3)) continue;
      // スワップ前の2コート合計より実力差ペナルティが悪化するなら見送る
      if (skillGapOf(newAIds) + skillGapOf(newBIds) > originalSkillGap) continue;

      courtA.selected = newA;
      courtB.selected = newB;
      break;
    }
  }
}

/**
 * 「予約の成立により休憩から呼び出して配置に使える」メンバーの ID 集合を返す。
 *
 * pending 予約のうち以下を全て満たすものの休憩中メンバーを集める:
 * - 予約人数が 1〜playersPerCourt 人（singles=2, doubles=4）
 * - メンバー全員が在席し、誰もコートで試合中でない（=成立可能）
 * - 試合数が中央値+閾値以上のメンバーを含まない（assignCourts の保留判定と同じ）
 * - 待機人数で残り枠を補充できる（waiting >= playersPerCourt - 予約人数）
 *
 * UI の配置可否判定（canAutoAssign）や連続モードの最小待機人数ゲートで
 * 「待機者 + 呼び出し可能な休憩者」として人数カウントに加算する。
 * 複数予約が待機者を取り合うケース等の厳密な成立判定はしない（近似）。
 * 最終的な配置可否は従来どおり assignCourts 本体が判定する。
 */
export function getCallableReservationRestingIds(
  presentPlayers: Player[],
  reservations: Reservation[],
  playersInCourts: Set<string>,
  options?: {
    gameMode?: 'singles' | 'doubles';
    reservationBlockThreshold?: number;
  }
): Set<string> {
  const callable = new Set<string>();
  const pending = reservations.filter(r => r.status === 'pending');
  if (pending.length === 0) return callable;

  const playersPerCourt = (options?.gameMode ?? 'doubles') === 'singles' ? 2 : 4;
  const threshold =
    options?.reservationBlockThreshold ?? DEFAULT_RESERVATION_BLOCK_THRESHOLD;

  const byId = new Map(presentPlayers.map(p => [p.id, p]));
  const waitingCount = presentPlayers.filter(
    p => !p.isResting && !playersInCourts.has(p.id)
  ).length;

  // 中央値は在席全員（休憩者含む）で算出（assignCourts の保留判定と同じ母集団）
  const sortedGames = presentPlayers.map(p => p.gamesPlayed).sort((a, b) => a - b);
  const mid = Math.floor(sortedGames.length / 2);
  const medianGamesPlayed = sortedGames.length === 0
    ? 0
    : sortedGames.length % 2 === 0
      ? (sortedGames[mid - 1] + sortedGames[mid]) / 2
      : sortedGames[mid];

  for (const reservation of pending) {
    const ids = reservation.playerIds;
    if (ids.length < 1 || ids.length > playersPerCourt) continue;

    const members = ids.map(id => byId.get(id)).filter((p): p is Player => p !== undefined);
    if (members.length !== ids.length) continue;
    if (members.some(m => playersInCourts.has(m.id))) continue;
    if (members.some(m => m.gamesPlayed - medianGamesPlayed >= threshold)) continue;
    if (waitingCount < playersPerCourt - members.length) continue;

    for (const m of members) {
      if (m.isResting) callable.add(m.id);
    }
  }

  return callable;
}

/**
 * 自動配置アルゴリズム
 * - レーティングベースのグルーピング（3等分/2等分）
 * - 固定コート配置（3コート: upper→C1, middle→C2, lower→C3）+ 借用フォールバック
 * - ホリスティック配置（2コート同時）
 * - 各個人の直近2試合で3人以上の重複を回避
 * - 上位/下位の孤立を回避（3コート）
 * - プレイ回数少ない人を優先
 * - 敗北時に序列降下（ceil(groupSize/2)）
 */
export function assignCourts(
  players: Player[],
  courtCount: number,
  matchHistory: Match[],
  options?: {
    totalCourtCount?: number;
    targetCourtIds?: number[];
    practiceStartTime?: number;
    allPlayers?: Player[];  // 全アクティブプレイヤー（他コートでプレイ中含む）。グループ分けに使用
    useStayDurationPriority?: boolean;
    reservations?: Reservation[];
    gameMode?: 'singles' | 'doubles'; // シングルス/ダブルス（デフォルト: doubles）
    lateBalanceMode?: boolean; // 後半均等化モード（試合数の少ない人を強く優先）
    reservationBlockThreshold?: number; // 予約保留の閾値（中央値+この値以上のメンバーを含む予約を保留）
    restingPlayers?: Player[]; // 休憩中で予約により呼び出せるメンバー（通常配置の対象外）
  }
): CourtAssignment[] {
  const activePlayers = players.filter((p) => !p.isResting);
  // 予約は休憩中メンバーも対象に探す（通常配置は activePlayers のみ）
  const restingPlayers = options?.restingPlayers ?? [];
  const reservationPool = [...activePlayers, ...restingPlayers];
  const restingIdSet = new Set(restingPlayers.map(p => p.id));
  const totalCourtCount = options?.totalCourtCount ?? courtCount;
  const targetCourtIds = options?.targetCourtIds ??
    Array.from({ length: courtCount }, (_, i) => i + 1);
  const practiceStartTime = options?.practiceStartTime ?? Date.now();
  const useStayDuration = options?.useStayDurationPriority ?? true;
  const pendingReservations = (options?.reservations ?? [])
    .filter(r => r.status === 'pending')
    .sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0));
  const gameMode = options?.gameMode ?? 'doubles';

  // 後半均等化モード: maxGamesPlayed は全アクティブプレイヤー（他コート中含む）から
  // 算出することで、待機者一覧の変動に左右されず一貫した「最大値」を得る。
  const lateBalance = ((): LateBalanceCtx | undefined => {
    if (!options?.lateBalanceMode) return undefined;
    const pool = options.allPlayers ?? activePlayers;
    if (pool.length === 0) return undefined;
    const maxGames = pool.reduce((max, p) => Math.max(max, p.gamesPlayed), 0);
    return { enabled: true, maxGamesPlayed: maxGames };
  })();

  // 予約保留判定: 予約メンバーの試合数が「中央値 + 閾値」以上なら、その予約全体を
  // 保留する。試合数の多い人が予約で順番を飛ばし続けるのを防ぐ。
  // 母集団は休憩者も含む全在席プレイヤーで算出（全員休憩でも中央値が0に潰れないように）。
  const reservationBlockThreshold =
    options?.reservationBlockThreshold ?? DEFAULT_RESERVATION_BLOCK_THRESHOLD;
  const medianGamesPlayed = ((): number => {
    const pool = [...(options?.allPlayers ?? activePlayers), ...restingPlayers];
    if (pool.length === 0) return 0;
    const sorted = pool.map(p => p.gamesPlayed).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  })();
  const isReservationBlocked = (playerIds: string[]): boolean =>
    playerIds.some(id => {
      const p = reservationPool.find(pl => pl.id === id);
      return p !== undefined && p.gamesPlayed - medianGamesPlayed >= reservationBlockThreshold;
    });

  // シングルスモードの場合
  if (gameMode === 'singles') {
    // 予約配置を先に処理
    const singlesReservationAssignments: CourtAssignment[] = [];
    const singlesUsedPlayers = new Set<string>();
    const singlesFulfilledIds: string[] = [];
    const singlesRemainingCourtIds = [...targetCourtIds];

    for (const reservation of pendingReservations) {
      if (singlesRemainingCourtIds.length === 0) break;

      // 予約メンバー全員が在席（待機 or 休憩）か確認
      const reservedPlayers = reservation.playerIds
        .map(id => reservationPool.find(p => p.id === id))
        .filter((p): p is Player => p !== undefined);

      if (reservedPlayers.length !== reservation.playerIds.length) continue;
      if (reservation.playerIds.some(id => singlesUsedPlayers.has(id))) continue;
      // 試合数が中央値+閾値以上のメンバーを含む予約は保留（pending のまま）
      if (isReservationBlocked(reservation.playerIds)) continue;

      const rsvPlayerIds = reservation.playerIds;

      if (rsvPlayerIds.length === 2) {
        // 2人: そのまま対戦
        const courtId = singlesRemainingCourtIds.shift()!;
        singlesReservationAssignments.push({
          courtId,
          teamA: [rsvPlayerIds[0], ''],
          teamB: [rsvPlayerIds[1], ''],
          activatedFromRestIds: rsvPlayerIds.filter(id => restingIdSet.has(id)),
        });
        rsvPlayerIds.forEach(id => singlesUsedPlayers.add(id));
        singlesFulfilledIds.push(reservation.id);
      } else if (rsvPlayerIds.length === 1) {
        // 1人: 相手を通常ロジックで選出（相手は待機者のみ）
        const nonReserved = activePlayers.filter(
          p => !singlesUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
        );
        if (nonReserved.length === 0) continue;
        nonReserved.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );
        const courtId = singlesRemainingCourtIds.shift()!;
        singlesReservationAssignments.push({
          courtId,
          teamA: [rsvPlayerIds[0], ''],
          teamB: [nonReserved[0].id, ''],
          activatedFromRestIds: rsvPlayerIds.filter(id => restingIdSet.has(id)),
        });
        singlesUsedPlayers.add(nonReserved[0].id);
        rsvPlayerIds.forEach(id => singlesUsedPlayers.add(id));
        singlesFulfilledIds.push(reservation.id);
      }
      // 3人以上の予約はシングルスでは無効（スキップ）
    }

    // 残りコートを通常シングルスロジックで埋める
    if (singlesRemainingCourtIds.length === 0) {
      return singlesReservationAssignments;
    }

    // 通常配置の候補は待機者（activePlayers）のうち予約配置で未使用の者。
    // 予約メンバーは休憩中なので activePlayers に含まれず自然に除外される。
    const singlesNormalCandidates = activePlayers.filter(
      p => !singlesUsedPlayers.has(p.id)
    );

    // 全コート分の人数が無い場合は、埋められるコート数まで縮小して部分配置する。
    // 1コートも埋められない場合のみ従来どおりエラー（予約配置があればそれだけ返す）。
    const singlesFillableCount = Math.min(
      singlesRemainingCourtIds.length,
      Math.floor(singlesNormalCandidates.length / 2)
    );
    if (singlesFillableCount === 0) {
      if (singlesReservationAssignments.length > 0) {
        return singlesReservationAssignments;
      }
      throw new SessionError(
        `アクティブなプレイヤーが不足しています（必要: ${singlesRemainingCourtIds.length * 2}人、現在: ${singlesNormalCandidates.length}人）`,
        'insufficient-players'
      );
    }
    singlesRemainingCourtIds.splice(singlesFillableCount);

    const singlesAssignments = assignCourtsSingles(
      singlesNormalCandidates, singlesRemainingCourtIds, matchHistory, practiceStartTime, useStayDuration, lateBalance
    );
    return [...singlesReservationAssignments, ...singlesAssignments];
  }

  // ダブルスモード: 予約配置を先に処理
  const reservationAssignments: CourtAssignment[] = [];
  const reservationUsedPlayers = new Set<string>();
  const fulfilledReservationIds: string[] = [];
  const remainingCourtIds = [...targetCourtIds];

  // パートナー/対戦相手重複・同一4人組み合わせ重複ペナルティ用の集計を1回だけ
  // 行い、以降の formTeams / selectBestFour 呼び出し（コート数ぶん、借用の
  // 段階拡大ループも含めると最大 n 回）に使い回す。
  const historyCounts = buildHistoryCounts(matchHistory);

  for (const reservation of pendingReservations) {
    if (remainingCourtIds.length === 0) break;

    // 予約メンバー全員が在席（待機 or 休憩）か確認
    const reservedPlayers = reservation.playerIds
      .map(id => reservationPool.find(p => p.id === id))
      .filter((p): p is Player => p !== undefined);

    if (reservedPlayers.length !== reservation.playerIds.length) continue;
    if (reservation.playerIds.some(id => reservationUsedPlayers.has(id))) continue;
    // 試合数が中央値+閾値以上のメンバーを含む予約は保留（pending のまま）
    if (isReservationBlocked(reservation.playerIds)) continue;

    const rsvPlayerIds = reservation.playerIds;
    // ダブルスでは 1〜4 人予約のみサポート。範囲外（旧データ等）は court を消費せず
    // スキップして reservationAssignments も fulfill にもしない（court が "失われる"
    // 不整合を防ぐ defensive guard）。
    if (rsvPlayerIds.length < 1 || rsvPlayerIds.length > 4) continue;
    // 予約メンバーのうち休憩中だった者（出場時に isResting=false にする）
    const activatedFromRestIds = rsvPlayerIds.filter(id => restingIdSet.has(id));

    const courtId = remainingCourtIds.shift()!;

    if (rsvPlayerIds.length === 4) {
      // 4人: 最初の2人 vs 残り2人で固定配置
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [rsvPlayerIds[2], rsvPlayerIds[3]] as [string, string],
        activatedFromRestIds,
      });
    } else if (rsvPlayerIds.length === 3) {
      // 3人: 最初の2人がペア + 3人目と通常ロジックで1人選出（同性優先。相手は待機者のみ）
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
      );
      if (nonReserved.length === 0) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
      );
      const sorted = sortByGenderPreference(rsvPlayerIds, nonReserved, reservationPool);
      const fourth = sorted[0];
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [rsvPlayerIds[2], fourth.id] as [string, string],
        activatedFromRestIds,
      });
      reservationUsedPlayers.add(fourth.id);
    } else if (rsvPlayerIds.length === 2) {
      // 2人: 同じチームとして配置 + 残り2人を通常ロジックで選出（同性優先。相手は待機者のみ）
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
      );
      if (nonReserved.length < 2) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
      );
      const sorted = sortByGenderPreference(rsvPlayerIds, nonReserved, reservationPool);
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [sorted[0].id, sorted[1].id] as [string, string],
        activatedFromRestIds,
      });
      reservationUsedPlayers.add(sorted[0].id);
      reservationUsedPlayers.add(sorted[1].id);
    } else if (rsvPlayerIds.length === 1) {
      // 1人: 最優先候補として通常ロジックで残り3人を選出（相手は待機者のみ）
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
      );
      if (nonReserved.length < 3) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
      );
      const groupingPlayers = options?.allPlayers ?? activePlayers;
      const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, totalCourtCount >= 3 ? 3 : 2);
      const fourPlayers = [
        reservationPool.find(p => p.id === rsvPlayerIds[0])!,
        nonReserved[0], nonReserved[1], nonReserved[2],
      ];
      const teams = formTeams(fourPlayers, playerOrder, matchHistory, historyCounts.pair);
      reservationAssignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB, activatedFromRestIds });
      reservationUsedPlayers.add(nonReserved[0].id);
      reservationUsedPlayers.add(nonReserved[1].id);
      reservationUsedPlayers.add(nonReserved[2].id);
    }

    rsvPlayerIds.forEach(id => reservationUsedPlayers.add(id));
    fulfilledReservationIds.push(reservation.id);
  }

  // 予約で配置されなかった残りのコートを通常ロジックで埋める。
  // 予約メンバーは休憩中なので activePlayers に含まれず自然に除外される
  // （旧来の「未消化予約メンバーを通常配置から除外」ロジックは休憩で代替）。
  const normalCandidates = activePlayers.filter(
    p => !reservationUsedPlayers.has(p.id)
  );

  if (remainingCourtIds.length === 0) {
    return reservationAssignments;
  }

  // 全コート分の人数が無い場合は、埋められるコート数まで縮小して部分配置する
  // （例: 2コート10人で4人が予約休憩中 → 待機6人で1コートだけ配置）。
  // 1コートも埋められない場合のみ従来どおりエラー（予約配置があればそれだけ返す）。
  const fillableCourtCount = Math.min(
    remainingCourtIds.length,
    Math.floor(normalCandidates.length / 4)
  );
  if (fillableCourtCount === 0) {
    if (reservationAssignments.length > 0) {
      return reservationAssignments;
    }
    throw new SessionError(
      `アクティブなプレイヤーが不足しています（必要: ${remainingCourtIds.length * 4}人、現在: ${normalCandidates.length}人）`,
      'insufficient-players'
    );
  }
  const normalCourtIds = remainingCourtIds.slice(0, fillableCourtCount);
  const normalCourtCount = normalCourtIds.length;

  // グループ分けは全アクティブプレイヤー（他コートでプレイ中含む）で行う
  const groupingPlayers = options?.allPlayers ?? activePlayers;

  // 性別構成の偏りを許容するか判定（セッション全体で判定、ハード制約用）
  const allowUnbalanced = shouldAllowUnbalancedGender(groupingPlayers, normalCourtCount);
  // 少数派性別が1人で2-2構成が物理的に作れないか（ソフトペナルティ無効化用）
  const genderPairImpossible = isGenderPairImpossible(groupingPlayers);
  // 少数派性別が少なく、MIX（2-2）を同性（4-0）と同格に優遇すべきか
  const preferGenderMix = isMinorityGenderScarce(groupingPlayers);
  // preferGenderMix のときに「少数派側」がどちらの性別かを特定しておく
  // （3コート以上の動的グループ選択で、コートの候補が少数派1人だけになっていないか判定するため）
  const scarceMinorityGender = preferGenderMix ? getScarceMinorityGender(groupingPlayers) : null;

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && normalCourtCount === 2) {
    const holistic = assign2CourtsHolistic(normalCandidates, normalCourtIds, matchHistory, practiceStartTime, groupingPlayers, useStayDuration, lateBalance, genderPairImpossible, historyCounts);
    return [...reservationAssignments, ...holistic];
  }

  // グループ分け（グローバル）
  const groups3 = totalCourtCount >= 3 ? groupPlayers3Court(groupingPlayers, matchHistory) : null;

  // 序列を計算（formTeamsのペアリングに使用）
  const groupCount = totalCourtCount >= 3 ? 3 : 2;
  const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, groupCount);

  // 実力差ペナルティ用の序列（ハシゴ式で撹拌する前の、素の序列）
  const baseRankById = new Map(
    buildInitialOrder(groupingPlayers).map((id, index) => [id, index] as const)
  );

  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 3コート以上の場合、動的グループ選択を使用
  if (totalCourtCount >= 3 && normalCourtCount >= 1 && groups3) {
    // このラウンドの各コートの選出結果（チーム分け前）。preferGenderMix のとき
    // ループ終了後に repairLoneMinorityPairs で少数派の分散を修復するため、
    // formTeams / assignments.push は後段でまとめて行う。
    const courtSelections: { courtId: number; selected: Player[] }[] = [];

    for (let i = 0; i < normalCourtCount; i++) {
      const courtId = normalCourtIds[i];

      // このラウンドでまだ使っていない人だけで見て2-2が作りようがないか
      // （改善1・候補A。詳細は isGenderPairImpossible の直後のコメント参照）。
      // セッション全体では少数派が2人以上いても、既に先のコートで片方が
      // 使われてしまうと、このコート以降の残りでは少数派が実質1人だけになる。
      // genderPairImpossible（セッション全体で1人）とは別に扱い、getGenderPenalty
      // 側で弱めたペナルティ（完全無効化ではない）を課す。
      const roundGenderPairImpossible =
        !!preferGenderMix && isGenderPairImpossible(normalCandidates.filter(p => !usedPlayers.has(p.id)));

      // 最も待っているグループを選択
      const targetGroup = selectMostUrgentGroup(
        groups3, normalCandidates, usedPlayers, practiceStartTime, useStayDuration, lateBalance
      );

      if (!targetGroup) {
        // 全グループが使い切られた or 偏差制限にかかった
        // フォールバック: 残りの全員から選ぶ
        const remaining = normalCandidates.filter(p => !usedPlayers.has(p.id));
        if (remaining.length < 4) break;

        remaining.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );

        const selected = selectBestFour(
          remaining, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance, baseRankById, genderPairImpossible, preferGenderMix, historyCounts, roundGenderPairImpossible
        );

        selected.forEach(p => usedPlayers.add(p.id));
        courtSelections.push({ courtId, selected });
        continue;
      }

      // ターゲットグループのメンバーを取得
      const groupMembers = normalCandidates.filter(
        p => groups3.get(targetGroup)!.has(p.id) && !usedPlayers.has(p.id)
      );

      let selected: Player[];

      if (groupMembers.length >= 4) {
        // このコートの候補は自分のレーティング帯のメンバーだけに限定する（隣接
        // グループからの事前借用はしない）。他コートが確定する前に候補を
        // 先取りしてしまうと、後から処理されるコートが残り物しか選べなくなる
        // 「逐次貪欲」の原因になるため（このラウンドの全コート選出が終わった後、
        // repairCourtConstraints でコート間スワップとしてまとめて後始末する。
        // 詳細は同関数のコメント参照）。
        const candidates = [...groupMembers].sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );
        selected = selectBestFour(
          candidates, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance, baseRankById, genderPairImpossible, preferGenderMix, historyCounts, roundGenderPairImpossible
        );
      } else {
        // 自グループの残り人数が4人に満たない場合のみの例外処理。groups3 は
        // 常に3グループ固定なので、4コート以上では1グループが同じラウンドで
        // 2つ以上のコートを賄うことがあり得るほか、3コートでも最大偏差制限で
        // 他グループが一時的に選択対象から外れ、同じグループが連続して選ばれる
        // ことがある。いずれも「先取りによる圧迫」ではなく人数不足という
        // 構造的な事情のため、他グループから補って選び直す。
        //
        // 補充候補は優先度順（＝待たされている順）に採る。selectBestFour の
        // 組み合わせ探索は O(候補数^4) のため、候補プール全体を渡すと重くなる
        // （実測: 20人4コートで1ラウンドの配置が数十msに悪化）。補充候補には
        // 「不足分＋いくらかの選択の余地」だけ渡せば十分なので、優先度順に
        // 上位から必要数＋バッファ分だけに絞る。
        const groupMemberIds = new Set(groupMembers.map(p => p.id));
        const rest = normalCandidates.filter(
          p => !usedPlayers.has(p.id) && !groupMemberIds.has(p.id)
        );
        rest.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );
        const need = 4 - groupMembers.length;
        const candidates = [...groupMembers, ...rest.slice(0, need + RESCUE_CANDIDATE_BUFFER)];

        if (candidates.length < 4) {
          throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
        }

        candidates.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );

        selected = selectBestFour(
          candidates, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance, baseRankById, genderPairImpossible, preferGenderMix, historyCounts, roundGenderPairImpossible
        );
      }

      if (selected.length < 4) {
        throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
      }

      selected.forEach(p => usedPlayers.add(p.id));
      courtSelections.push({ courtId, selected });
    }

    // 各コートを自分のレーティング帯だけから選んだ結果、直近試合の重複・
    // 上下孤立・性別ハード制約のいずれかに違反したまま残っているコートが
    // あれば、コート間スワップで解消を試みる（詳細は repairCourtConstraints 参照）。
    repairCourtConstraints(
      courtSelections.map(c => c.selected), matchHistory, baseRankById,
      { groups3, allowUnbalanced, candidatePoolForGenderCheck: normalCandidates }
    );

    // 少数派性別が少ないセッションでは、このラウンドの各コートの選出結果を
    // 見て、少数派がちょうど1人だけの（3-1になりかねない）コートが2つ以上
    // あれば、少数派同士を同じコートにまとめられないか修復を試みる
    // （詳細は repairLoneMinorityPairs 参照）。
    if (preferGenderMix && scarceMinorityGender) {
      repairLoneMinorityPairs(courtSelections, scarceMinorityGender, matchHistory, groups3, baseRankById);
    }

    for (const { courtId, selected } of courtSelections) {
      const teams = formTeams(selected, playerOrder, matchHistory, historyCounts.pair);
      assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
    }

    return [...reservationAssignments, ...assignments];
  }

  // 1コート または 2コートの1コートずつ配置
  // （シンプルな優先度ベース配置）
  for (let i = 0; i < normalCourtCount; i++) {
    const courtId = normalCourtIds[i];

    // 1コート配置時の最大偏差制限
    let candidatePool = normalCandidates.filter(p => !usedPlayers.has(p.id));
    if (totalCourtCount === 1 && candidatePool.length >= 4) {
      const avgGames = candidatePool.reduce((sum, p) => sum + p.gamesPlayed, 0) / candidatePool.length;
      const eligible = candidatePool.filter(p => p.gamesPlayed <= avgGames + MAX_GAMES_ABOVE_AVERAGE);
      if (eligible.length >= 4) {
        candidatePool = eligible;
      }
    }

    // 優先度順にソート
    candidatePool.sort((a, b) =>
      calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
      calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
    );

    // 制約を満たす4人を選択
    const selected = selectBestFour(
      candidatePool, matchHistory, groups3, totalCourtCount,
      practiceStartTime, useStayDuration, allowUnbalanced, lateBalance, baseRankById, genderPairImpossible, preferGenderMix, historyCounts
    );

    if (selected.length < 4) {
      throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
    }

    selected.forEach(p => usedPlayers.add(p.id));

    // チーム分け（序列ベースの最強+最弱ペアリング）
    const teams = formTeams(selected, playerOrder, matchHistory, historyCounts.pair);
    assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
  }

  return [...reservationAssignments, ...assignments];
}

/**
 * 待機メンバーを配置優先度順にソート
 */
export function sortWaitingPlayers(
  waitingPlayers: Player[],
  options: {
    emptyCourtIds: number[];
    totalCourtCount: number;
    matchHistory: Match[];
    allActivePlayers: Player[];
    practiceStartTime: number;
    useStayDuration: boolean;
    lateBalanceMode?: boolean;
  }
): Player[] {
  const { practiceStartTime, useStayDuration, lateBalanceMode } = options;

  const lateBalance: LateBalanceCtx | undefined = lateBalanceMode && options.allActivePlayers.length > 0
    ? {
        enabled: true,
        maxGamesPlayed: options.allActivePlayers.reduce(
          (max, p) => Math.max(max, p.gamesPlayed),
          0,
        ),
      }
    : undefined;

  // 優先度スコア順にソート（低いほど優先）
  return [...waitingPlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
    calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
  );
}

// シングルスペア評価のソフト重み（優先度: 連続回避 > 総当たり > 試合数均等 > レーティング）
// W_RECENCY を最強に設定: 直前プレイ者を含むペアは、過去対戦のあるペアよりも避けるべき。
// minRest=0 時の最大ペナルティ 500 で、実用範囲の balance 差 (~6 試合 → 300) と
// RR 差 (~4 対戦 → 40) を上回る。2 分以上休めばペナルティ 0 になり、その後は
// 試合数均等 (1 試合=50) → 総当たり (1 対戦=10) → レーティング (W=0.02) の順に効く。
const SINGLES_WEIGHT_RECENCY = 500;
const SINGLES_WEIGHT_BALANCE = 50;
const SINGLES_WEIGHT_ROUNDROBIN = 10;
const SINGLES_WEIGHT_RATING = 0.02;
// 直前プレイ判定の閾値（分）。これ未満ならペナルティが線形に最大値へ近づく
const SINGLES_REST_THRESHOLD_MIN = 2;

/**
 * シングルスペアのコストを計算（小さいほど好ましい）
 * 強度順:
 * - 連続回避ペナルティ (W_RECENCY=500、直前プレイ側がいるペアに最大ペナルティ)
 * - 試合数合計 (gamesPlayed合計 * W_BALANCE)
 * - 総当たり (matchCount * W_ROUNDROBIN)
 * - レーティング差 (タイブレーク)
 */
function computeSinglesPairCost(
  a: Player,
  b: Player,
  matchCount: number,
  now: number,
): number {
  const totalGames = a.gamesPlayed + b.gamesPlayed;

  // 未プレイ (lastPlayedAt === 0) はペナルティ無し
  const restA = a.lastPlayedAt > 0 ? (now - a.lastPlayedAt) / (1000 * 60) : Infinity;
  const restB = b.lastPlayedAt > 0 ? (now - b.lastPlayedAt) / (1000 * 60) : Infinity;
  const minRest = Math.min(restA, restB);
  const recencyPenalty = minRest < SINGLES_REST_THRESHOLD_MIN
    ? (SINGLES_REST_THRESHOLD_MIN - minRest) / SINGLES_REST_THRESHOLD_MIN
    : 0;

  // 未設定 (undefined) または 0 は unrated 扱いで 1500 に正規化
  // （buildInitialOrder の挙動に合わせ、unrated にペナルティが付かないようにする）
  const ratingA = (a.rating ?? 0) > 0 ? a.rating! : 1500;
  const ratingB = (b.rating ?? 0) > 0 ? b.rating! : 1500;
  const ratingDiff = Math.abs(ratingA - ratingB);

  return (
    SINGLES_WEIGHT_RECENCY * recencyPenalty +
    SINGLES_WEIGHT_BALANCE * totalGames +
    SINGLES_WEIGHT_ROUNDROBIN * matchCount +
    SINGLES_WEIGHT_RATING * ratingDiff
  );
}

/**
 * 候補から N 個の非重複ペアを選び、合計コストが最小の組合せを返す。
 * 「最小インデックスを使うか/スキップするか」のバックトラッキングで、
 * 候補の全部分集合（サイズ 2N）× 全ペアリングを 1 回ずつ列挙する。
 * 候補数 ≤ 10 / N ≤ 3 想定で十分高速。
 */
function findBestSinglesPairing(
  candidates: Player[],
  pairCount: number,
  getMatchCount: (id1: string, id2: string) => number,
  now: number,
): Player[][] | null {
  if (pairCount === 0) return [];
  if (candidates.length < pairCount * 2) return null;

  let bestPairing: Player[][] | null = null;
  let bestCost = Infinity;

  const recurse = (
    remaining: Player[],
    pairsLeft: number,
    accPairs: Player[][],
    accCost: number,
  ): void => {
    if (accCost >= bestCost) return;
    if (pairsLeft === 0) {
      bestCost = accCost;
      bestPairing = accPairs.map(p => [...p]);
      return;
    }
    if (remaining.length < pairsLeft * 2) return;

    // 同コスト時に優先度の高い (= 候補リスト先頭の) プレイヤーを含むペアを採用するため
    // 「先頭を使う」分岐を先に探索する。
    const first = remaining[0];
    for (let i = 1; i < remaining.length; i++) {
      const partner = remaining[i];
      const cost = computeSinglesPairCost(
        first, partner, getMatchCount(first.id, partner.id), now
      );
      const next: Player[] = [];
      for (let k = 1; k < remaining.length; k++) {
        if (k !== i) next.push(remaining[k]);
      }
      accPairs.push([first, partner]);
      recurse(next, pairsLeft - 1, accPairs, accCost + cost);
      accPairs.pop();
    }

    // 先頭をスキップ（残り候補だけで人数が足りる場合のみ）
    if (remaining.length - 1 >= pairsLeft * 2) {
      recurse(remaining.slice(1), pairsLeft, accPairs, accCost);
    }
  };

  recurse(candidates, pairCount, [], 0);
  return bestPairing;
}

/**
 * シングルス用の配置アルゴリズム（強度順）
 * - 連続回避: 直前にプレイしたユーザを含むペアにペナルティ（最優先）
 * - 試合回数の差を抑制: ペア合算の gamesPlayed が低いほど好まれる
 * - 総当たり優先: まだ対戦していない（少ない）ペアを優先
 * - レーティング近接: 他条件が拮抗時に近いレーティング同士を好む（タイブレーク）
 */
// Singles ペアリングのコスト関数 (computeSinglesPairCost) は SINGLES_WEIGHT_BALANCE
// で gamesPlayed 合計を直接ペナルティ化しており、独立した均等化メカニズムを持つ。
// そのため lateBalance はここでは prioritySorted (候補プール切り出し) と最終的な
// pair → court 割当順 (minScore) にだけ影響し、効果はダブルスより限定的。
function assignCourtsSingles(
  activePlayers: Player[],
  targetCourtIds: number[],
  matchHistory: Match[],
  practiceStartTime: number,
  useStayDuration: boolean,
  lateBalance?: LateBalanceCtx,
): CourtAssignment[] {
  const requiredPlayers = targetCourtIds.length * 2;
  if (activePlayers.length < requiredPlayers) {
    throw new SessionError(
      `アクティブなプレイヤーが不足しています（必要: ${requiredPlayers}人、現在: ${activePlayers.length}人）`,
      'insufficient-players'
    );
  }

  // 対戦回数マップを構築 (p1Id-p2Id => 回数)
  const matchCountMap = new Map<string, number>();
  for (const match of matchHistory) {
    const a = match.teamA[0];
    const b = match.teamB[0];
    if (!a || !b) continue;
    const key = [a, b].sort().join('-');
    matchCountMap.set(key, (matchCountMap.get(key) || 0) + 1);
  }
  const getMatchCount = (p1Id: string, p2Id: string): number => {
    const key = [p1Id, p2Id].sort().join('-');
    return matchCountMap.get(key) || 0;
  };

  // 最大偏差プレフィルタ: 平均より3試合以上多い人は除外（候補プールが必要数を割ったら緩和）
  const avgGames = activePlayers.reduce((sum, p) => sum + p.gamesPlayed, 0) / activePlayers.length;
  let eligiblePlayers = activePlayers.filter(p => p.gamesPlayed <= avgGames + MAX_GAMES_ABOVE_AVERAGE);
  if (eligiblePlayers.length < requiredPlayers) {
    eligiblePlayers = activePlayers;
  }

  // 優先度順にソートして候補プールを切り出し（gamesPlayed=0 の初回保証は -Infinity スコアで担保）
  const prioritySorted = [...eligiblePlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
    calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
  );
  const candidateCount = Math.min(eligiblePlayers.length, requiredPlayers + 4);
  const candidates = prioritySorted.slice(0, candidateCount);

  // 全列挙でコスト合計最小のペアリングを選択
  const now = Date.now();
  const pairing = findBestSinglesPairing(
    candidates, targetCourtIds.length, getMatchCount, now
  );

  if (!pairing) {
    throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
  }

  // 優先度が高いペア（最低スコアが小さい）から若いコート ID に割り当てる
  const pairsWithPriority = pairing.map(pair => {
    const minScore = Math.min(
      calculatePriorityScore(pair[0], practiceStartTime, useStayDuration, lateBalance),
      calculatePriorityScore(pair[1], practiceStartTime, useStayDuration, lateBalance),
    );
    return { pair, minScore };
  });
  pairsWithPriority.sort((x, y) => x.minScore - y.minScore);

  return pairsWithPriority.map(({ pair }, idx) => ({
    courtId: targetCourtIds[idx],
    teamA: [pair[0].id, ''] as [string, string],
    teamB: [pair[1].id, ''] as [string, string],
  }));
}

/**
 * プレイヤー統計を計算
 */
export function calculatePlayerStats(
  players: Player[],
  matchHistory: Match[]
) {
  const stats = players.map((player) => ({
    id: player.id,
    name: player.name,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    points: 0,
  }));

  matchHistory.forEach((match) => {
    const { teamA, teamB, winner, scoreA, scoreB } = match;

    const updateStats = (playerId: string, isWinner: boolean, points: number) => {
      const stat = stats.find((s) => s.id === playerId);
      if (stat) {
        stat.gamesPlayed++;
        if (isWinner) stat.wins++;
        else stat.losses++;
        stat.points += points;
      }
    };

    teamA.forEach((id) => updateStats(id, winner === 'A', scoreA));
    teamB.forEach((id) => updateStats(id, winner === 'B', scoreB));
  });

  return stats;
}
