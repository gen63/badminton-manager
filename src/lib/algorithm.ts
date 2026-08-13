import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';
import { SessionError } from './errorHandler';
import { assignRoundByObjective } from './pairing/assignRound';

type RatingGroup = 'upper' | 'middle' | 'lower';

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
 * 入る割合、SEEDS=80）が 2.3% → 2.7% に悪化したため 0.2 まで下げていた。
 *
 * その後 0.6 に引き上げた。上記の「上げると分離が悪化する」制約は、3コート以上に
 * 素の序列でのハード制約（`hasTopBottomExtremes`）が無く、この上限が実質的に
 * 分離の最後の砦になっていたことに由来する。ハード制約を入れた
 * （docs/plans/2026-08-04-skill-band-guard-and-diversity.md）ことで多様性側に
 * 余裕ができ、0.2/0.4/0.6/0.8 を比較して 0.6 を採用した:
 * - 共演人数（1人あたりの異なる共演相手数）は 0.6 で頭打ちになる
 *   （21人3コート NOISE=0 で 13.23 → 13.32 → 13.52 → 13.54）
 * - 分離の悪化は 0.6 までは +0.3pt 以内に収まる
 *
 * ハード制約（層1）→ 実力差ペナルティ `SKILL_GAP_WEIGHT` = 2.0（層2）→ この上限
 * （層3）の順で効かせる設計なので、**2.0 を超えないこと**が上限値の制約になる。
 *
 * この定数は1回の選出では挙動が変わらない（0.2 と 0.6 で同じ4人が選ばれる）
 * 統計的なノブで、効果はセッション全体の集計に現れる。回帰の検出は
 * `scripts/bench-court-assignment.ts` が担う。
 */
const PAIR_REPEAT_PENALTY_CAP = 0.6;
/**
 * 「特定の1人に偏っている」ことへのペナルティの重み（oneGameDelta 単位）。
 *
 * `PAIR_REPEAT_PENALTY_CAP` の方は6ペアの回数を**合計**して上限を掛けるため、
 * 「1人と4回、他5ペアは0回」と「6ペアが均等に0〜1回」が同じ評価になってしまう。
 * 避けたいのは前者だけなので、6ペアのうち**最も顔を合わせている**ペアの回数に
 * 対して別枠でペナルティを掛ける。均等に散っている組には加算されない。
 *
 * 実データ（2026-08-04、21人44試合）では21人中19人で「最多相手の回数」が
 * 共演相手に均等配分した場合の上限を超えていた（美玖×あすか 6回 / 均等なら3回、
 * げん×りょーや 4回 / 均等なら2回）。合計ベースの上限をいくら上げても、また
 * 未共演ペアに段差を付けても、この偏りは検出できない
 * （docs/plans/2026-08-04-skill-band-guard-and-diversity.md の変更3・4）。
 *
 * 順位もレートも使わず履歴だけで決まるため、手動レートの間隔が校正されていない
 * ことに影響されない。
 */
const PAIR_CONCENTRATION_WEIGHT = 0.1;
/**
 * 集中度ペナルティの上限。`PAIR_REPEAT_PENALTY_CAP` とは別枠で加算されるため、
 * 層3の合計は最大 0.6 + 0.6 = 1.2 で `SKILL_GAP_WEIGHT`(2.0) を越えない。
 *
 * `WEIGHT = 0.1` との組で 6 回目の共演まで効き続ける。0.4 にすると 4 回で飽和し、
 * 実データにあった「美玖×あすか 6回」の 5・6 回目が無料になってしまう。
 * bench 上も 0.4 → 0.6 で分離のコストは増えず占有率だけ僅かに下がった
 * （21人3コート NOISE=0: 45.3% → 45.2%）。
 */
const PAIR_CONCENTRATION_CAP = 0.6;
/** 性別バランスで入れ替える際、待ち時間差がこの試合数未満なら入れ替えてよい */
const GENDER_SWAP_FAIRNESS_LIMIT = 2;
/**
 * `repairGenderParityWithBench`（3コート以上）で、呼び戻す人（待機列から招集）の
 * 累積試合数が、ベンチに回す人（今ラウンド外す）の累積試合数をこの値を超えて
 * 上回っていたら入れ替えない（詳細は同関数コメント参照）。0（同数まで許容、
 * それ以上多く出場した人を呼び戻すのは禁止）を採用。マイナス（呼び戻す人が
 * 厳密に少ない場合のみ許可）に締めても改善効果がほぼ無くなる一方、0 より
 * 緩めると（同関数の待機2人以上ガードと組み合わせても）試合数差が悪化する
 * ケースがあったため、-1.5〜2 の範囲で試した中で 0 が最も安全だった。
 */
const GENDER_PARITY_BALANCE_TOLERANCE = 0;
/** 平均よりこの試合数以上多い人は候補から外す（最大偏差制限） */
const MAX_GAMES_ABOVE_AVERAGE = 3;
/** 直近試合の重複判定で、各個人の何試合前まで遡るか */
const RECENT_MATCH_LOOKBACK = 3;
/** 直近試合と何人重複したら「似た試合」と見なすか */
const RECENT_MATCH_OVERLAP_LIMIT = 3;
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
 * 「大きく実力が離れている」と見なす順位差の比率（ロースター人数に対する割合）。
 * 21人なら `ceil(21 * 2/3) = 14` で、順位が14以上離れた2人は同じコートに入れない。
 *
 * バンド方式（上位N人 × 下位N人だけを禁止）ではなく**順位差そのもの**で見るのは、
 * 「両端どうしだけ」ではなく「離れていれば誰でも」弾くのが目的だから。
 *
 * 比率は bench で 1/2 / 0.6 / 2/3 / 0.75 / 0.85 を比較して決めた。2/3 より厳しく
 * しても目的3 は改善しない（制約を満たす組が枯れてフォールバックが増えるため、
 * 21人3コートで 2/3→4.2% に対し 0.6→4.4% / 0.5→4.6% と逆に悪化する）。
 * 計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
 */
const WIDE_RANK_SPAN_RATIO = 2 / 3;

/**
 * 順位差のハード制約を効かせる最小人数。これ未満はソフトな `getSkillGapPenalty` に任せる。
 *
 * 12〜13人2コートは待機が4〜5人しかなく、制約を入れると目的3 は改善する一方で
 * 目的5（性別3-1）が 12人で 4.6% → 11.4%、13人で 3.7% → 8.9% へ倍増し、
 * 多様性・公平性も揃って悪化する。目的3 ひとつのために他の4指標を落とすことになる。
 *
 * そもそも少人数セッションでは全体の実力幅自体が狭く、「大きく離れている」が
 * 成立しにくい（`MIN_ROSTER_FOR_SKILL_GAP` と同じ考え方）。
 * 計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
 */
const WIDE_RANK_SPAN_MIN_ROSTER = 14;

/**
 * 4人の中に「大きく実力の離れた」組み合わせが含まれるか（目的3 のハード制約）。
 * 4人の順位の最大−最小がそのまま最大のペア間距離なので、これだけ見ればよい。
 *
 * `MIN_ROSTER_FOR_SKILL_GAP` 未満の少人数では選択の余地が無いため判定しない。
 */
function hasWideRankSpan(
  comboIds: string[],
  baseRankById: Map<string, number>,
  ratio: number = WIDE_RANK_SPAN_RATIO,
): boolean {
  const rosterSize = baseRankById.size;
  if (rosterSize < WIDE_RANK_SPAN_MIN_ROSTER) return false;
  const threshold = Math.ceil(rosterSize * ratio);

  let min = Infinity;
  let max = -Infinity;
  for (const id of comboIds) {
    const rank = baseRankById.get(id);
    if (rank === undefined) continue;
    if (rank < min) min = rank;
    if (rank > max) max = rank;
  }
  if (min === Infinity) return false;
  return max - min >= threshold;
}

/**
 * 2コート同時配置で選出済みの8人を、2つの4人組へ分割する最良の組合せを
 * 全探索で求める（8人から4人を選ぶ C(8,4)/2 = 35 通り）。
 *
 * 3コート以上の `selectBestFour` と同じペナルティ関数（実力差・性別・同一
 * 組み合わせ重複・パートナー/対戦相手重複）を使い、2コート合計が最小になる
 * 分割を選ぶ。`selectBestFour` は「候補プールから1コート分の4人を選ぶ」逐次的な
 * 探索だが、2コート同時配置は8人全員の行き先が決まっているため、2コート分を
 * 同時に評価してより良い分割を選べる。
 *
 * さらに `hasTopBottomExtremes` で「上位3人×下位3人が同じコートに入る」組合せを
 * ハードに除外する（3コート以上の `hasIsolatedExtreme` に相当。8人全員の
 * 行き先を同時に決められるため、2コートでも同様の直接排除が使える）。
 * 除外後に有効な組合せが無ければ、コストのみで最良のものにフォールバックする。
 *
 * 性別の少数派を同じコートにまとめる（改善2 相当）挙動は、`getGenderPenalty`
 * が 3-1 を強くペナルティ化し 2-2/4-0 を優遇することで自然に再現される
 * （専用の強制まとめロジックを持たない）。
 */
function splitBestTwoCourts(
  eight: Player[],
  matchHistory: Match[],
  baseRankById: Map<string, number>,
  oneGameDelta: number,
  genderPairImpossible: boolean,
  preferGenderMix: boolean,
  historyCounts: HistoryCounts,
): { courtA: Player[]; courtB: Player[] } {
  const n = eight.length;
  const recentMatchPenalty = (ids: string[]): number =>
    hasSimilarRecentMatch(ids, matchHistory) ? oneGameDelta * COMBO_REPEAT_PENALTY : 0;
  const groupCost = (group: Player[]): number => {
    const ids = group.map(p => p.id);
    return (
      getGenderPenalty(group, oneGameDelta, genderPairImpossible, preferGenderMix) +
      getSkillGapPenalty(ids, baseRankById, oneGameDelta) +
      getComboRepeatPenalty(ids, historyCounts.combo, oneGameDelta) +
      getPairRepeatPenalty(ids, historyCounts.pair, oneGameDelta) +
      recentMatchPenalty(ids)
    );
  };

  let bestA: Player[] = eight.slice(0, 4);
  let bestB: Player[] = eight.slice(4);
  let bestScore = Infinity;
  // ハード制約（上位3×下位3の同居禁止）を満たす組合せが見つかったかどうか。
  // 見つかった場合はそれらの中でのみ最良を選ぶ。1件も無ければ制約を無視して
  // コストのみで最良を選ぶ（全滅を避けるフォールバック）。
  let bestValidScore = Infinity;
  let bestValidA: Player[] | null = null;
  let bestValidB: Player[] | null = null;

  // eight[0] は常に groupA 側に固定し、(A, B) と (B, A) の重複探索を避ける。
  for (let i = 1; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const idxA = new Set([0, i, j, k]);
        const groupA: Player[] = [];
        const groupB: Player[] = [];
        for (let idx = 0; idx < n; idx++) {
          (idxA.has(idx) ? groupA : groupB).push(eight[idx]);
        }
        const idsA = groupA.map(p => p.id);
        const idsB = groupB.map(p => p.id);
        const score = groupCost(groupA) + groupCost(groupB);

        if (score < bestScore) {
          bestScore = score;
          bestA = groupA;
          bestB = groupB;
        }

        const isValid = !hasWideRankSpan(idsA, baseRankById) && !hasWideRankSpan(idsB, baseRankById);
        if (isValid && score < bestValidScore) {
          bestValidScore = score;
          bestValidA = groupA;
          bestValidB = groupB;
        }
      }
    }
  }

  if (bestValidA && bestValidB) {
    return { courtA: bestValidA, courtB: bestValidB };
  }
  return { courtA: bestA, courtB: bestB };
}

/** 文字列から32bit整数のハッシュ値を計算する（FNV-1a） */
function hashStringToSeed(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 32bit シードから [0, 1) の疑似乱数列を生成する（mulberry32）。
 * `Math.random()` と同じ一様分布の値を返すが、同じシードなら常に同じ列になる。
 * コート配置のランダムノイズを再現可能にするために使う（後述）。
 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  preferGenderMix: boolean = false,
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

  // 3. 選ばれたプレイヤーを序列順に並べ替え
  const initialOrder = buildInitialOrder(groupingPlayers);
  const order = applyStreakSwaps(initialOrder, matchHistory, 2);
  const orderedSelected = order
    .filter(id => selected.some(p => p.id === id))
    .map(id => selected.find(p => p.id === id)!);

  // 実力差ペナルティ用の序列（ハシゴ式で撹拌する前の、素の序列）。
  // repairCourtConstraints のスワップガードと repairScatteredMinorityPair2Court
  // の両方で使う。
  const baseRankById = new Map(initialOrder.map((id, index) => [id, index] as const));

  // 4. 8人を2つの4人組に分割する（3コート以上の selectBestFour と同じペナルティ
  // 関数＋上位×下位同居のハード排除を使う全探索。詳細は splitBestTwoCourts 参照）。
  // 少数派を同じコートにまとめる挙動は getGenderPenalty の 3-1 ペナルティで
  // 自然に再現される（専用の強制まとめロジックは持たない）。
  const oneGameDelta = computeOneGameDelta(practiceStartTime, useStayDuration);
  const counts = historyCounts ?? buildHistoryCounts(matchHistory);
  const { courtA, courtB } = splitBestTwoCourts(
    orderedSelected, matchHistory, baseRankById, oneGameDelta, genderPairImpossible, preferGenderMix, counts
  );

  // 5. 直近試合制約のチェック・修正
  // options を渡し（groups3 なし）、実力差ガードだけを有効にする。3コート以上と
  // 違い性別ハード制約は渡さない（gender 判定は selectBestFour/getGenderPenalty
  // 側で既に扱っているため、ここで候補プールを渡すと不要な副作用が出ることを
  // 実測で確認したため）。
  repairCourtConstraints([courtA, courtB], matchHistory, baseRankById, {});

  // 5.5 直近試合スワップで意図した性別まとめ（2-2 + 4-0）が崩れていないか
  // 確認し、崩れていれば修復する（repairCourtConstraints より後に置く理由は
  // 関数コメント参照）。同数(4:4)のときは minorityGender が定まらないため対象外。
  const femaleCount = orderedSelected.filter(p => p.gender === 'F').length;
  const maleCount = orderedSelected.filter(p => p.gender === 'M').length;
  const minorityGender: 'M' | 'F' | null =
    femaleCount < maleCount ? 'F' : maleCount < femaleCount ? 'M' : null;
  if (minorityGender) {
    repairScatteredMinorityPair2Court(courtA, courtB, minorityGender, matchHistory, baseRankById);
  }

  // 6. コートID割り当て。固定（小さいID=courtA）にすると実力帯で分割された
  // 側が常に同じ物理コートに固定され回転（使ったコート数）が落ちるため、
  // その場の状態から導出したシード付き乱数でどちらのコートIDに割り当てるか
  // 決める（3コート以上は「最も待っているグループ」の選択順で自然に混ざるが、
  // 2コートは常にA/B2値しかないため明示的に混ぜる必要がある）。
  const sortedCourtIds = [...targetCourtIds].sort((a, b) => a - b);
  const noiseSeedKey =
    `${matchHistory.length}:${targetCourtIds.join(',')}:${orderedSelected.map(p => p.id).join(',')}`;
  const seededRandom = createSeededRandom(hashStringToSeed(noiseSeedKey));
  const [firstCourt, secondCourt] = seededRandom() < 0.5 ? [courtA, courtB] : [courtB, courtA];

  // 7. チーム編成（序列ベースの最強+最弱ペアリング）
  const firstTeams = formTeams(firstCourt, order, matchHistory, pairCounts);
  const secondTeams = formTeams(secondCourt, order, matchHistory, pairCounts);

  return [
    { courtId: sortedCourtIds[0], teamA: firstTeams.teamA, teamB: firstTeams.teamB },
    { courtId: sortedCourtIds[1], teamA: secondTeams.teamA, teamB: secondTeams.teamB },
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
 * 滞在時間モードでの「滞在開始時刻」を決定する。
 *
 * 会費・名簿が未対応のまま滞在時間だけが積み上がり、対応済みの人より
 * 優先されてしまう不公平を避けるため、起点は「休憩解除時刻」ではなく
 * 「会費・名簿が両方完了した時刻」を基準にする。3ケース:
 *
 * 1. 会費・名簿とも完了 & `opsCompletedAt` あり
 *    → `max(practiceStartTime, opsCompletedAt)`
 * 2. 会費・名簿とも完了 & `opsCompletedAt` なし（このフィールド追加前に
 *    完了した既存セッション互換）→ `max(practiceStartTime, activatedAt ?? now)`（従来どおり）
 * 3. 会費・名簿のどちらか未完了
 *    → `now`（＝滞在時間ゼロ扱い。下限5分ペナルティが効く）
 *
 * 詳細: docs/plans/2026-08-11-stay-start-at-ops-complete.md
 */
function resolveStayStart(player: Player, practiceStartTime: number, now: number): number {
  const opsComplete = player.operationStatus?.payment === true && player.operationStatus?.roster === true;
  if (!opsComplete) {
    return now;
  }
  if (player.opsCompletedAt !== undefined) {
    return Math.max(practiceStartTime, player.opsCompletedAt);
  }
  return Math.max(practiceStartTime, player.activatedAt ?? now);
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
    const stayStart = resolveStayStart(player, practiceStartTime, now);
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
 * repairCourtConstraints・repairGenderParityWithBench で「性別3-1のみ」を
 * 直すスワップに許す実力差ガードの緩め幅（getSkillGapPenalty と同じ
 * oneGameDelta=1 換算、2コート合計の悪化量）。3コート・13〜16人のような
 * 少人数では、各コートが自分の実力帯からしか選ばれないため性別調整の余地が
 * ほぼ無く、実力差を一切悪化させないガードのままだと3-1修復のスワップ候補が
 * ほぼ通らない（実測で確認済み。詳細は repairCourtConstraints 冒頭コメント参照）。
 * 0/0.5/1.0/1.5/2.0/3.0/4.0/8.0 を比較した結果、2.0（＝ SKILL_GAP_WEIGHT
 * 片コート分の最大ペナルティに相当）以上では効果が頭打ちになったため、
 * 「無制限」ではなく意味のある上限として 2.0 を採用した。
 */
const GENDER_GAP_ALLOWANCE = SKILL_GAP_WEIGHT;

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
  // 6ペアのうち最も顔を合わせている回数（パートナー・対戦相手を区別せず合算）
  let maxEncounters = 0;
  for (let i = 0; i < comboIds.length; i++) {
    for (let j = i + 1; j < comboIds.length; j++) {
      const key = pairKey(comboIds[i], comboIds[j]);
      const partnerCount = pairCounts.partner.get(key) ?? 0;
      const opponentCount = pairCounts.opponent.get(key) ?? 0;
      partnerTotal += partnerCount;
      opponentTotal += opponentCount;
      const encounters = partnerCount + opponentCount;
      if (encounters > maxEncounters) maxEncounters = encounters;
    }
  }
  const raw = PARTNER_REPEAT_WEIGHT * partnerTotal + OPPONENT_REPEAT_WEIGHT * opponentTotal;
  // 合計ベースの重複ペナルティと、特定の1人への偏りのペナルティを別枠で加算する
  return oneGameDelta * (
    Math.min(raw, PAIR_REPEAT_PENALTY_CAP) +
    Math.min(PAIR_CONCENTRATION_WEIGHT * maxEncounters, PAIR_CONCENTRATION_CAP)
  );
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
  //
  // 上下の実力帯同居（hasTopBottomExtremes）だけは他のハード制約と切り離して
  // 二段構えにする（`isValidBase` = 従来の制約。上下同居はこれに加えてループ内で
  // 都度チェックする）。2コート同時配置の `splitBestTwoCourts` と同じ考え方: 優先度
  // スコア上位を素朴に弾くと待たされている人を飛ばすことになるため、"ハード制約を
  // 満たす組が1つも無い" ときに `candidates.slice(0, 4)` へ一気に落ちると、直近試合の
  // 重複や性別構成といった他のハード制約まで巻き添えで緩んでしまう。そうならないよう
  // 「上下同居を含め全部満たす組」→ 無ければ「上下同居だけ緩めた組」→ それも無ければ
  // 最終フォールバックとして上位4人、の3段階にする。
  const isValidBase = (ids: string[]): boolean => {
    if (hasSimilarRecentMatch(ids, matchHistory)) return false;
    if (totalCourtCount >= 3 && groups3 && hasIsolatedExtreme(ids, groups3)) return false;
    if (!allowUnbalanced && hasUnbalancedGender(ids, candidates)) return false;  // 性別構成チェック（条件付き）
    return true;
  };

  // 逐次配置（1コートずつ選出するこの経路）でも、同時配置経路
  // （`splitBestTwoCourts`）と同じ `hasTopBottomExtremes` で上位×下位の同居を
  // ハードに弾く。`baseRankById` が無い呼び出しでは従来どおり判定しない。
  //
  // 3コート以上でも適用する。`isValidBase` 側の `hasIsolatedExtreme` は
  // `groupPlayers3Court` の出力＝**ハシゴ式（`applyStreakSwaps`）適用後**の序列で
  // 判定するため、勝利で上位グループへ移動した下位者は「上位の人」として扱われ、
  // 上位×下位の同居を検出できない。素の序列（`baseRankById`）で見る
  // `hasTopBottomExtremes` はハシゴ式の出力に依存しないので、この抜けを塞ぐ。
  // ソフトな `getSkillGapPenalty` も素の序列で見るが、グループ内の全候補が同程度の
  // ペナルティを負うため順位づけに差がつかず、単独では機能しない。
  // 詳細: docs/plans/2026-08-04-skill-band-guard-and-diversity.md
  //
  // バンド幅は `splitBestTwoCourts`（同時配置）の 3 人固定とは異なり、人数に応じて
  // 狭める（`SEQUENTIAL_EXTREME_BAND` / `SEQUENTIAL_EXTREME_BAND_MIN_ROSTER`）。
  // 逐次配置は「候補プールから優先度順に 1 コート 4 人を選ぶ」経路のため、同時配置
  // （8 人の行き先を同時に決め、コート間で動かすだけ）と違って制約が人の選出そのものを
  // 弾き、待たされている人を飛ばしてしまう。
  const hasSkillGapHardConstraint = !!baseRankById;
  const skillGapHardRatio = WIDE_RANK_SPAN_RATIO;

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
  // isValidBase のみを満たす（上下同居は許す）組の中での最良。上下同居を
  // 弾いた結果 bestCombo が1件も見つからなかったときのフォールバック用。
  let bestBaseCombo: Player[] | null = null;
  let bestBaseScore = Infinity;

  const n = candidates.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const combo = [candidates[i], candidates[j], candidates[k], candidates[l]];
          const ids = combo.map(p => p.id);
          if (!isValidBase(ids)) continue;

          const s = combo.reduce((sum, p) => sum + playerScore(p), 0)
            + getGenderPenalty(combo, oneGameDelta, genderPairImpossible, preferGenderMix, roundGenderPairImpossible)
            + getComboRepeatPenalty(ids, counts.combo, oneGameDelta)
            + getPairRepeatPenalty(ids, counts.pair, oneGameDelta)
            + (baseRankById ? getSkillGapPenalty(ids, baseRankById, oneGameDelta) : 0);

          if (s < bestBaseScore) {
            bestBaseScore = s;
            bestBaseCombo = combo;
          }

          if (hasSkillGapHardConstraint && hasWideRankSpan(ids, baseRankById!, skillGapHardRatio)) continue;

          if (s < bestScore) {
            bestScore = s;
            bestCombo = combo;
          }
        }
      }
    }
  }

  // 有効な組み合わせが見つからない場合は制約緩和（上下同居のみ許容 → それも
  // 無ければ最終手段として上位4人）
  return bestCombo ?? bestBaseCombo ?? candidates.slice(0, 4);
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
  const isRecentOrIsolated = (ids: string[]): boolean =>
    hasSimilarRecentMatch(ids, matchHistory) ||
    (!!options?.groups3 && hasIsolatedExtreme(ids, options.groups3));
  const isGenderUnbalanced = (ids: string[]): boolean =>
    !options?.allowUnbalanced && !!options?.candidatePoolForGenderCheck &&
    hasUnbalancedGender(ids, options.candidatePoolForGenderCheck);
  const isViolating = (ids: string[]): boolean =>
    isRecentOrIsolated(ids) || isGenderUnbalanced(ids);

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
    // 直近試合重複・上下孤立を伴わない「純粋な性別3-1」だけ実力差ガードを緩める
    // （直近試合・上下孤立の修復は現行どおり厳格に保つ。GENDER_GAP_ALLOWANCE 参照）
    const isPureGenderRepair =
      isGenderUnbalanced(court.map(p => p.id)) && !isRecentOrIsolated(court.map(p => p.id));
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
          // 性別3-1のみを直すスワップは、実力差ガードを GENDER_GAP_ALLOWANCE
          // 分だけ緩める（無制限には許さない）。直近試合重複・上下孤立の
          // 修復はこれまでどおり悪化を一切許さない。
          const allowance = isPureGenderRepair ? GENDER_GAP_ALLOWANCE : 0;
          const gapOk = !enforceSkillGapGuard || newGap <= originalGap + allowance;

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
 * 3コート以上・男女がおおむね半々のセッション向け: `repairCourtConstraints`
 * 後もなお性別3-1が残っているコートについて、待機列（このラウンド選ばれな
 * かった人）とのベンチ入れ替えで解消を試みる。
 *
 * 背景: `repairCourtConstraints` のコート間スワップは、既に選ばれた12人の中で
 * メンバーを動かすだけなので、選ばれた12人の中の性別内訳（合計の奇数/偶数）の
 * パリティを変えられない。少数派人数が奇数（5人など）なら、コート間でどう
 * 入れ替えても必ずどこか1コートは3-1のまま残る（実測で確認済み。実力差ガード
 * をどれだけ緩めても解消しない）。待機列には選ばれなかった側の性別が余って
 * いることが多く、そこと入れ替えることでパリティごと変えられる。
 *
 * 事前予測ではなく、実際に3-1が残ったコートに対してだけ後始末として行う
 * （選出前に予測して先回りでベンチを決める方式も試したが、動的グループ選択の
 * 実際の結果とズレて無関係なコートの分離まで悪化させることがあった。実測:
 * 15人3コートで上位3×下位3が12.8%→16.1%、3-1が13.2%→16.1%に悪化。
 * 後始末方式に切り替えて解消）。
 *
 * フェアネス: 呼び戻す待機者の `gamesPlayed` が、ベンチに回す人のそれを
 * `GENDER_PARITY_BALANCE_TOLERANCE` 試合分より多く上回るなら入れ替えない
 * （既に多く出場した人をさらに増やす入れ替えを防ぐ）。
 * 実力差ガードは `GENDER_GAP_ALLOWANCE` まで緩める（`repairCourtConstraints`
 * と同じ扱い。直近試合の重複・上下孤立は緩めない）。
 * 少数派が少ない（`preferGenderMix`）セッションと `allowUnbalanced`
 * （3-1をハード制約として許容するセッション）は対象外（前者は
 * `repairLoneMinorityPairs` が専用の修復を担当するため、二重に手を入れると
 * 過矯正になり得る。後者はそもそも3-1を許容する設定のため）。
 */
function repairGenderParityWithBench(
  courtSelections: { courtId: number; selected: Player[] }[],
  normalCandidates: Player[],
  usedPlayers: Set<string>,
  matchHistory: Match[],
  groups3: Map<RatingGroup, Set<string>>,
  baseRankById: Map<string, number>,
  allowUnbalanced: boolean,
  practiceStartTime: number,
  useStayDuration: boolean,
  lateBalance: LateBalanceCtx | undefined,
): void {
  if (allowUnbalanced) return;
  const priorityOf = (p: Player) =>
    calculatePriorityScore(p, practiceStartTime, useStayDuration, lateBalance);
  const waiting = normalCandidates.filter(p => !usedPlayers.has(p.id));
  // 待機が1人だけだと、その1人の性別方向にしか入れ替えられず一方向に偏る
  // （実測: 13人3コート・待機1人で試合数差が -1.78 まで悪化）。待機2人以上の
  // ときだけ行う（14人以上の3コートなら通常満たす）。
  if (waiting.length < 2) return;

  const skillGapOf = (ids: string[]): number => getSkillGapPenalty(ids, baseRankById, 1);

  for (const court of courtSelections) {
    const ids = court.selected.map(p => p.id);
    if (!hasUnbalancedGender(ids, normalCandidates)) continue;

    const maleCount = court.selected.filter(p => p.gender === 'M').length;
    const excessGender: 'M' | 'F' = maleCount === 1 ? 'F' : 'M';
    const deficitGender: 'M' | 'F' = excessGender === 'F' ? 'M' : 'F';

    // 招集候補: 待機中の不足性別を優先度の高い順（待たされている順）に
    const waitingDeficit = waiting
      .filter(p => p.gender === deficitGender)
      .sort((a, b) => priorityOf(a) - priorityOf(b));
    if (waitingDeficit.length === 0) continue;
    const toInclude = waitingDeficit[0];

    // ベンチ候補: コート内の過多性別を優先度の低い順（既に出場が進んでいる順）に
    // gamesPlayed === 0 は初回保証のため除外しない（呼び戻す側で保証済みなら可）
    const excessOnCourt = court.selected
      .filter(p => p.gender === excessGender && (p.gamesPlayed > 0 || toInclude.gamesPlayed === 0))
      .sort((a, b) => priorityOf(b) - priorityOf(a));
    if (excessOnCourt.length === 0) continue;
    const toExclude = excessOnCourt[0];

    // フェアネス: 呼び戻す人が既に多く出場しているなら入れ替えない
    if (toInclude.gamesPlayed > toExclude.gamesPlayed + GENDER_PARITY_BALANCE_TOLERANCE) continue;

    const newIds = ids.map(id => (id === toExclude.id ? toInclude.id : id));
    if (hasSimilarRecentMatch(newIds, matchHistory)) continue;
    if (hasIsolatedExtreme(newIds, groups3)) continue;
    if (hasUnbalancedGender(newIds, normalCandidates)) continue; // 保険（通常は解消するはず）

    // 実力差ガードは性別3-1の修復に限り GENDER_GAP_ALLOWANCE まで緩める
    // （repairCourtConstraints と同じ考え方）
    if (skillGapOf(newIds) > skillGapOf(ids) + GENDER_GAP_ALLOWANCE) continue;

    const idx = court.selected.findIndex(p => p.id === toExclude.id);
    court.selected[idx] = toInclude;
    usedPlayers.delete(toExclude.id);
    usedPlayers.add(toInclude.id);
    const wIdx = waiting.findIndex(p => p.id === toInclude.id);
    waiting.splice(wIdx, 1);
    waiting.push(toExclude);
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
 *
 * 予約・休憩・シングルス・強制休憩などの前処理をこの関数が担い、
 * 「誰を出して、どう4人に分けるか」の本体は **既定で目的関数ベースの新エンジン**
 * `assignRoundByObjective`（`src/lib/pairing/`）に委譲する
 * （`useObjectiveEngine` の既定が true。docs/plans/2026-08-05-pairing-goals-and-rewrite.md）。
 * 新エンジンはハード制約（順位差の閾値 / 直近試合との重複）→ 6目的の重み付き合計 →
 * 決定的な局所探索、という構成で、**コート ID ごとの実力帯の割り当ては持たない**
 * （ラウンド全体をまとめて最適化する）。
 *
 * 以降の記述は `useObjectiveEngine: false` を明示したときだけ通る**旧エンジン**の仕様:
 * - レーティングベースのグルーピング（3等分/2等分）
 * - 3コート以上: 動的グループ選択（`selectMostUrgentGroup` が最も待たされている
 *   レーティング帯を1コートずつ選ぶ。コート ID との固定対応ではない）+ 借用フォールバック
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
    /**
     * 目的関数ベースの新エンジン（`src/lib/pairing/`）を使うかどうか。**既定 true**
     * （切り替えコミット: cabf45e）。false を明示したときだけ旧エンジンを通る。
     * true のとき、予約・休憩・シングルス・強制休憩の処理はすべて既存のまま通し、
     * 「誰を出して、どう4人に分けるか」の部分だけ `assignRoundByObjective` に委譲する。
     * docs/plans/2026-08-05-pairing-goals-and-rewrite.md 参照。
     */
    useObjectiveEngine?: boolean;
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
  //
  // **待機時間優先モードではスコア減算を行わない。** 減算は「最大試合数 − 自分の
  // 試合数」を引く＝**回数**を揃える動きだが、待機時間優先は「試合数 ÷ 滞在分数」＝
  // **密度**を揃えるモードで、目的が正面から矛盾する。併用すると遅参加者が終盤の
  // コートを占有した（在席比例に対する倍率が 1.20 → 1.52）。
  //
  // 待機時間優先モードでの後半均等化は、新エンジン側の「公平性の窓を狭める」
  // （`LATE_BALANCE_WINDOW_RATIO`）だけで実現する。窓はそのモード自身の優先度順を
  // 締めるだけなので、密度の公平を強めることになりモードの定義と矛盾しない。
  // 計測: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
  const lateBalance = ((): LateBalanceCtx | undefined => {
    if (!options?.lateBalanceMode) return undefined;
    if (useStayDuration) return undefined;
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

  // 新エンジン（目的関数ベースの同時配置）。**既定 true = 本番はここを通る**。
  // docs/plans/2026-08-05-pairing-goals-and-rewrite.md の新設計を別モジュールとして
  // 実装したもので、既存の selectBestFour / applyStreakSwaps / groupPlayers3Court /
  // 修復パス群には一切触れない。以降の旧エンジンは useObjectiveEngine: false を
  // 明示したとき（主にテスト・bench の比較用）だけ通る。
  if (options?.useObjectiveEngine ?? true) {
    const objectiveBaseRankById = new Map(
      buildInitialOrder(groupingPlayers).map((id, index) => [id, index] as const)
    );
    const objectiveRosterSize = objectiveBaseRankById.size;
    const objectiveWideSpanThreshold =
      objectiveRosterSize < WIDE_RANK_SPAN_MIN_ROSTER
        ? null
        : Math.ceil(objectiveRosterSize * WIDE_RANK_SPAN_RATIO);
    const assigned = assignRoundByObjective({
      candidates: normalCandidates,
      courtIds: normalCourtIds,
      rankById: objectiveBaseRankById,
      rosterSize: objectiveRosterSize,
      priorityScoreOf: (p) =>
        calculatePriorityScore(p, practiceStartTime, useStayDuration, lateBalance),
      pairCounts: historyCounts.pair,
      pairKeyOf: pairKey,
      isRecentDuplicate: (ids) => hasSimilarRecentMatch(ids, matchHistory),
      wideSpanThreshold: objectiveWideSpanThreshold,
      preferGenderMix,
      lateBalanceMode: options?.lateBalanceMode ?? false,
    });
    return [...reservationAssignments, ...assigned];
  }

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && normalCourtCount === 2) {
    const holistic = assign2CourtsHolistic(normalCandidates, normalCourtIds, matchHistory, practiceStartTime, groupingPlayers, useStayDuration, lateBalance, genderPairImpossible, historyCounts, preferGenderMix);
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

    // 男女がおおむね半々のセッションで、上のコート間スワップでも性別3-1が
    // 残っているコートがあれば、待機列とのベンチ入れ替えで解消を試みる
    // （詳細は repairGenderParityWithBench 参照。少数派が少ないセッションは
    // 直後の repairLoneMinorityPairs が別途担当するため対象外）。
    if (!preferGenderMix) {
      repairGenderParityWithBench(
        courtSelections, normalCandidates, usedPlayers, matchHistory, groups3, baseRankById,
        allowUnbalanced, practiceStartTime, useStayDuration, lateBalance
      );
    }

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

// シングルスペア評価のソフト重み（優先度: 連続回避 > 総当たり > 試合数均等 > 序列差）
// W_RECENCY を最強に設定: 直前プレイ者を含むペアは、過去対戦のあるペアよりも避けるべき。
// minRest=0 時の最大ペナルティ 500 で、実用範囲の balance 差 (~6 試合 → 300) と
// RR 差 (~4 対戦 → 40) を上回る。2 分以上休めばペナルティ 0 になり、その後は
// 試合数均等 (1 試合=50) → 総当たり (1 対戦=10) → 序列差 (W=0.02) の順に効く。
const SINGLES_WEIGHT_RECENCY = 500;
const SINGLES_WEIGHT_BALANCE = 50;
const SINGLES_WEIGHT_ROUNDROBIN = 10;
/**
 * 序列差（順位の差）の重み。**レート差ではなく順位差**を使う。
 *
 * `player.rating` は人が付けた序列決定用の値で、**間隔が校正されていない**
 * （`docs/plans/2026-07-29-rating-vocabulary.md` で `ordering` → `skill` に改名した
 * とおり、順序を決めるための道具）。差を距離として扱うと、実力が突出して低い人が
 * 1人いるだけでその人絡みのコストだけ跳ね上がる。ダブルス側は `baseRankById`
 * （順位）で一貫しているので、シングルスも順位差に揃える。
 *
 * 21人なら順位差の最大は 20 で、旧実装のレート差の実効範囲（実データで最大 21.67）と
 * ほぼ同スケールのため重みは 0.02 のまま据え置いた（最大 0.4、総当たり1対戦=10 の
 * 25分の1でタイブレークとしてのみ効く）。
 */
const SINGLES_WEIGHT_RANK_GAP = 0.02;
// 直前プレイ判定の閾値（分）。これ未満ならペナルティが線形に最大値へ近づく
const SINGLES_REST_THRESHOLD_MIN = 2;

/**
 * シングルスペアのコストを計算（小さいほど好ましい）
 * 強度順:
 * - 連続回避ペナルティ (W_RECENCY=500、直前プレイ側がいるペアに最大ペナルティ)
 * - 試合数合計 (gamesPlayed合計 * W_BALANCE)
 * - 総当たり (matchCount * W_ROUNDROBIN)
 * - 序列差 (タイブレーク。レート差ではなく順位差)
 */
function computeSinglesPairCost(
  a: Player,
  b: Player,
  matchCount: number,
  now: number,
  rankById: Map<string, number>,
): number {
  const totalGames = a.gamesPlayed + b.gamesPlayed;

  // 未プレイ (lastPlayedAt === 0) はペナルティ無し
  const restA = a.lastPlayedAt > 0 ? (now - a.lastPlayedAt) / (1000 * 60) : Infinity;
  const restB = b.lastPlayedAt > 0 ? (now - b.lastPlayedAt) / (1000 * 60) : Infinity;
  const minRest = Math.min(restA, restB);
  const recencyPenalty = minRest < SINGLES_REST_THRESHOLD_MIN
    ? (SINGLES_REST_THRESHOLD_MIN - minRest) / SINGLES_REST_THRESHOLD_MIN
    : 0;

  // 序列（buildInitialOrder の並び）での順位差。unrated は buildInitialOrder が
  // middle の開始位置へ挿入するので、そのまま順位として扱えばよい。
  // 序列に載っていない人がいた場合はタイブレークを効かせない（0 扱い）。
  const rankA = rankById.get(a.id);
  const rankB = rankById.get(b.id);
  const rankGap = rankA === undefined || rankB === undefined ? 0 : Math.abs(rankA - rankB);

  return (
    SINGLES_WEIGHT_RECENCY * recencyPenalty +
    SINGLES_WEIGHT_BALANCE * totalGames +
    SINGLES_WEIGHT_ROUNDROBIN * matchCount +
    SINGLES_WEIGHT_RANK_GAP * rankGap
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
  rankById: Map<string, number>,
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
        first, partner, getMatchCount(first.id, partner.id), now, rankById
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

  // 序列（順位）を作る。ダブルス側の baseRankById と同じく buildInitialOrder を使い、
  // レートは順序を決めるためだけに参照する。
  const rankById = new Map(
    buildInitialOrder(activePlayers).map((id, index) => [id, index] as const)
  );

  // 全列挙でコスト合計最小のペアリングを選択
  const now = Date.now();
  const pairing = findBestSinglesPairing(
    candidates, targetCourtIds.length, getMatchCount, now, rankById
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
