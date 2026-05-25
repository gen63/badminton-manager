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
      if (newStreak >= 2 && newStreak % 2 === 0) {
        // 2連勝ごとにグループ1つ分上に移動
        const newIdx = Math.max(0, idx - stepSize);
        if (newIdx < idx) {
          order.splice(idx, 1);
          order.splice(newIdx, 0, id);
        }
      } else {
        // 通常の勝利: 1つ上に移動
        if (idx > 0) {
          order.splice(idx, 1);
          order.splice(idx - 1, 0, id);
        }
      }
    }

    // 敗北側: ceil(groupSize/2) 下に移動
    for (const id of losers) {
      streaks.set(id, 0);
      const idx = order.indexOf(id);
      if (idx === -1) continue;
      const newIdx = Math.min(order.length - 1, idx + dropAmount);
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
      if (found >= 3) break;  // 直近3試合をチェック
      const match = matchHistory[i];
      const matchMembers = [...match.teamA, ...match.teamB];
      if (!matchMembers.includes(playerId)) continue;
      found++;

      const overlap = fourPlayerIds.filter(id => matchMembers.includes(id));
      if (overlap.length >= 3) return true;
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
 * 4人を序列に基づいて最強+最弱ペアリングで2チームに編成
 * 序列順にソートし、1位+4位 vs 2位+3位 を返す
 * 2M+2Fの場合、MF vs MFになるようペアリングを調整する
 */
export function formTeams(
  fourPlayers: Player[],
  playerOrder: string[]
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
    if (!defaultIsMix) {
      // 1+3 vs 2+4 を試す（1+2 vs 3+4 よりスキルバランスが良い）
      const altIsMix = isMixedPair(sorted[0], sorted[2]) && isMixedPair(sorted[1], sorted[3]);
      if (altIsMix) {
        return {
          teamA: [sorted[0].id, sorted[2].id],
          teamB: [sorted[1].id, sorted[3].id],
        };
      }
    }
  }

  // デフォルト: 1位+4位 vs 2位+3位（最強+最弱ペア）
  return {
    teamA: [sorted[0].id, sorted[3].id],
    teamB: [sorted[1].id, sorted[2].id],
  };
}

/**
 * 2コート同時配置時の直近試合制約修正
 * 各コートの4人が直近試合と3人以上重複していたら、コート間でスワップを試みる
 */
function tryFixRecentMatch(
  court1: Player[],
  court2: Player[],
  matchHistory: Match[]
): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    const src = attempt === 0 ? court1 : court2;
    const dst = attempt === 0 ? court2 : court1;

    if (!hasSimilarRecentMatch(src.map(p => p.id), matchHistory)) continue;

    // 末尾（序列的に境界に近い人）からスワップを試みる
    for (let i = src.length - 1; i >= 0; i--) {
      for (let j = 0; j < dst.length; j++) {
        [src[i], dst[j]] = [dst[j], src[i]];
        if (!hasSimilarRecentMatch(src.map(p => p.id), matchHistory) &&
            !hasSimilarRecentMatch(dst.map(p => p.id), matchHistory)) {
          return;
        }
        [src[i], dst[j]] = [dst[j], src[i]];
      }
    }
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
): CourtAssignment[] {
  // 最大偏差制限: 平均より3試合以上多い人は除外
  const allGamesPlayed = activePlayers.map(p => p.gamesPlayed);
  const avgGames = allGamesPlayed.reduce((sum, g) => sum + g, 0) / allGamesPlayed.length;
  
  let eligiblePlayers = activePlayers.filter(
    p => p.gamesPlayed <= avgGames + 3
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
  const allGendered = selected.every(p => p.gender === 'M' || p.gender === 'F');
  if (allGendered) {
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
          const oneGameDelta = useStayDuration
            ? 1 / Math.max((Date.now() - practiceStartTime) / (1000 * 60), 5)
            : 1.0;
          if (replacePriority - excludePriority < oneGameDelta * 2) {
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
    tryFixRecentMatch(upperCourt, lowerCourt, matchHistory);

    // 7. コートID割り当て（小さいID = upperコート）
    const sortedCourtIds = [...targetCourtIds].sort((a, b) => a - b);

    // 8. チーム編成（序列ベースの最強+最弱ペアリング）
    const upperTeams = formTeams(upperCourt, order);
    const lowerTeams = formTeams(lowerCourt, order);

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
      score: probC1 + Math.random() * 1.8,
    };
  });
  courtScores.sort((a, b) => b.score - a.score);
  const upperCourt = courtScores.slice(0, 4).map(cs => cs.player);
  const lowerCourt = courtScores.slice(4).map(cs => cs.player);

  // 6. 直近試合制約のチェック・修正
  tryFixRecentMatch(upperCourt, lowerCourt, matchHistory);

  // 7. コートID割り当て（小さいID = upperコート）
  const sortedCourtIds = [...targetCourtIds].sort((a, b) => a - b);

  // 8. チーム編成（序列ベースの最強+最弱ペアリング）
  const upperTeams = formTeams(upperCourt, order);
  const lowerTeams = formTeams(lowerCourt, order);

  return [
    { courtId: sortedCourtIds[0], teamA: upperTeams.teamA, teamB: upperTeams.teamB },
    { courtId: sortedCourtIds[1], teamA: lowerTeams.teamA, teamB: lowerTeams.teamB },
  ];
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
    baseScore = player.gamesPlayed * 0.4;
  } else {
    const now = Date.now();
    // 滞在開始時刻 = max(練習開始日時, 休憩解除時刻)
    const stayStart = Math.max(practiceStartTime, player.activatedAt ?? now);
    // 滞在時間（分）、最低5分
    const stayMinutes = Math.max((now - stayStart) / (1000 * 60), 5);
    baseScore = player.gamesPlayed / stayMinutes;
  }

  if (lateBalance?.enabled) {
    const gap = lateBalance.maxGamesPlayed - player.gamesPlayed;
    if (gap > 0) {
      const oneGameDelta = useStayDuration
        ? 1 / Math.max((Date.now() - practiceStartTime) / (1000 * 60), 5)
        : 1.0;
      baseScore -= gap * LATE_BALANCE_WEIGHT * oneGameDelta;
    }
  }

  return baseScore;
}

/**
 * 4人の性別構成に基づくペナルティを計算
 * 4人全員に性別が設定されている場合のみ有効
 * 2-2（MIX）or 4-0（同性）→ 0、3-1 → ペナルティ
 */
function getGenderPenalty(
  combo: Player[],
  oneGameDelta: number
): number {
  const genders = combo.map(p => p.gender).filter(Boolean);
  if (genders.length < 4) return 0; // 性別未設定がいる場合は影響なし

  const maleCount = genders.filter(g => g === 'M').length;
  
  // 優先順位: 同性（4-0） > MIX（2-2） > 3-1
  
  // 3-1構成 → 強ペナルティ（制約でも弾かれる）
  if (maleCount === 1 || maleCount === 3) {
    return oneGameDelta * 3.0;
  }
  
  // MIX（2-2）→ 軽いペナルティ（同性より優先度低め）
  if (maleCount === 2) {
    return oneGameDelta * 0.5;
  }
  
  // 同性（4-0 or 0-4）→ ペナルティなし（最優先）
  return 0;
}

/**
 * セッション通算で同じ4人の組み合わせが繰り返される場合のペナルティ
 * 2回目までは許容、3回目以降は強いペナルティを加算
 */
function getComboRepeatPenalty(
  comboIds: string[],
  matchHistory: Match[],
  oneGameDelta: number
): number {
  const key = [...comboIds].sort().join(',');
  let count = 0;
  for (const match of matchHistory) {
    const matchKey = [...match.teamA, ...match.teamB].sort().join(',');
    if (matchKey === key) count++;
  }
  // 3回目以降を強く回避（2回までは許容）
  return count >= 2 ? oneGameDelta * 3 : 0;
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
    if (groupAvgGames > avgGames + 3) {
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
  const oneGameDelta = useStayDuration
    ? 1 / Math.max((Date.now() - practiceStartTime) / (1000 * 60), 5)
    : 1.0;

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
            + getGenderPenalty(combo, oneGameDelta)
            + getComboRepeatPenalty(ids, matchHistory, oneGameDelta);

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

    if (singlesNormalCandidates.length < singlesRemainingCourtIds.length * 2) {
      if (singlesReservationAssignments.length > 0) {
        return singlesReservationAssignments;
      }
      throw new SessionError(
        `アクティブなプレイヤーが不足しています（必要: ${singlesRemainingCourtIds.length * 2}人、現在: ${singlesNormalCandidates.length}人）`,
        'insufficient-players'
      );
    }

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
      const teams = formTeams(fourPlayers, playerOrder);
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
  const normalCourtCount = remainingCourtIds.length;

  const normalCandidates = activePlayers.filter(
    p => !reservationUsedPlayers.has(p.id)
  );

  if (normalCourtCount === 0) {
    return reservationAssignments;
  }

  const requiredPlayers = normalCourtCount * 4;
  if (normalCandidates.length < requiredPlayers) {
    if (reservationAssignments.length > 0) {
      // 予約配置分だけ返す（残りのコートは人数不足で配置できない）
      return reservationAssignments;
    }
    throw new SessionError(
      `アクティブなプレイヤーが不足しています（必要: ${requiredPlayers}人、現在: ${normalCandidates.length}人）`,
      'insufficient-players'
    );
  }

  // グループ分けは全アクティブプレイヤー（他コートでプレイ中含む）で行う
  const groupingPlayers = options?.allPlayers ?? activePlayers;

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && normalCourtCount === 2) {
    const holistic = assign2CourtsHolistic(normalCandidates, remainingCourtIds, matchHistory, practiceStartTime, groupingPlayers, useStayDuration, lateBalance);
    return [...reservationAssignments, ...holistic];
  }

  // グループ分け（グローバル）
  const groups3 = totalCourtCount >= 3 ? groupPlayers3Court(groupingPlayers, matchHistory) : null;

  // 性別構成の偏りを許容するか判定（セッション全体で判定）
  const allowUnbalanced = shouldAllowUnbalancedGender(groupingPlayers, normalCourtCount);

  // 序列を計算（formTeamsのペアリングに使用）
  const groupCount = totalCourtCount >= 3 ? 3 : 2;
  const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, groupCount);

  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 3コート以上の場合、動的グループ選択を使用
  if (totalCourtCount >= 3 && normalCourtCount >= 1 && groups3) {
    for (let i = 0; i < normalCourtCount; i++) {
      const courtId = remainingCourtIds[i];

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
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance
        );

        selected.forEach(p => usedPlayers.add(p.id));
        const teams = formTeams(selected, playerOrder);
        assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
        continue;
      }

      // ターゲットグループのメンバーを取得
      const groupMembers = normalCandidates.filter(
        p => groups3.get(targetGroup)!.has(p.id) && !usedPlayers.has(p.id)
      );

      // 隣接グループの借用候補を準備（制約を満たすため）
      const adjacentCandidates: Player[] = [];
      const groupMemberIds = new Set(groupMembers.map(p => p.id));
      const available = normalCandidates.filter(p => !usedPlayers.has(p.id) && !groupMemberIds.has(p.id));

      if (targetGroup === 'upper') {
        const middlePlayers = available.filter(p => groups3.get('middle')!.has(p.id));
        middlePlayers.sort((a, b) => playerOrder.indexOf(a.id) - playerOrder.indexOf(b.id));
        adjacentCandidates.push(...middlePlayers);
      } else if (targetGroup === 'lower') {
        const middlePlayers = available.filter(p => groups3.get('middle')!.has(p.id));
        middlePlayers.sort((a, b) => playerOrder.indexOf(b.id) - playerOrder.indexOf(a.id));
        adjacentCandidates.push(...middlePlayers);
      } else {
        const upperPlayers = available.filter(p => groups3.get('upper')!.has(p.id));
        upperPlayers.sort((a, b) => playerOrder.indexOf(b.id) - playerOrder.indexOf(a.id));
        const lowerPlayers = available.filter(p => groups3.get('lower')!.has(p.id));
        lowerPlayers.sort((a, b) => playerOrder.indexOf(a.id) - playerOrder.indexOf(b.id));
        const maxLen = Math.max(upperPlayers.length, lowerPlayers.length);
        for (let j = 0; j < maxLen; j++) {
          if (j < upperPlayers.length) adjacentCandidates.push(upperPlayers[j]);
          if (j < lowerPlayers.length) adjacentCandidates.push(lowerPlayers[j]);
        }
      }

      // 段階的に候補を拡大して探索
      let selected: Player[] | null = null;

      for (let expand = 0; expand <= adjacentCandidates.length; expand++) {
        const candidates = [...groupMembers];
        if (expand > 0) {
          candidates.push(...adjacentCandidates.slice(0, expand));
        }

        if (candidates.length < 4) continue;

        candidates.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );

        const result = selectBestFour(
          candidates, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance
        );

        const resultIds = result.map(p => p.id);
        const isValidResult = !hasSimilarRecentMatch(resultIds, matchHistory)
          && !hasIsolatedExtreme(resultIds, groups3)
          && (allowUnbalanced || !hasUnbalancedGender(resultIds, candidates));

        if (isValidResult) {
          selected = result;
          break;
        }

        if (expand === adjacentCandidates.length) {
          selected = result;
        }
      }

      if (!selected) {
        const allAvailable = normalCandidates.filter(p => !usedPlayers.has(p.id));
        allAvailable.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration, lateBalance) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration, lateBalance)
        );
        selected = selectBestFour(
          allAvailable, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced, lateBalance
        );
      }

      if (selected.length < 4) {
        throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
      }

      selected.forEach(p => usedPlayers.add(p.id));
      const teams = formTeams(selected, playerOrder);
      assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
    }

    return [...reservationAssignments, ...assignments];
  }

  // 1コート または 2コートの1コートずつ配置
  // （シンプルな優先度ベース配置）
  for (let i = 0; i < normalCourtCount; i++) {
    const courtId = remainingCourtIds[i];

    // 1コート配置時の最大偏差制限
    let candidatePool = normalCandidates.filter(p => !usedPlayers.has(p.id));
    if (totalCourtCount === 1 && candidatePool.length >= 4) {
      const avgGames = candidatePool.reduce((sum, p) => sum + p.gamesPlayed, 0) / candidatePool.length;
      const eligible = candidatePool.filter(p => p.gamesPlayed <= avgGames + 3);
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
      practiceStartTime, useStayDuration, allowUnbalanced, lateBalance
    );

    if (selected.length < 4) {
      throw new SessionError('プレイヤーの割り当てに失敗しました', 'assignment-failed');
    }

    selected.forEach(p => usedPlayers.add(p.id));

    // チーム分け（序列ベースの最強+最弱ペアリング）
    const teams = formTeams(selected, playerOrder);
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
// minRest=0 時の最大ペナルティ 500 で、実用範囲の RR 差 (~4 試合) と
// balance 差 (~60) を上回る。3 分以上休めばペナルティ 0 になり、その後は
// 総当たり (W=100) → 試合数均等 (W=10) → レーティング (W=0.02) の順に効く。
const SINGLES_WEIGHT_RECENCY = 500;
const SINGLES_WEIGHT_ROUNDROBIN = 100;
const SINGLES_WEIGHT_BALANCE = 10;
const SINGLES_WEIGHT_RATING = 0.02;
// 直前プレイ判定の閾値（分）。これ未満ならペナルティが線形に最大値へ近づく
const SINGLES_REST_THRESHOLD_MIN = 3;

/**
 * シングルスペアのコストを計算（小さいほど好ましい）
 * 強度順:
 * - 連続回避ペナルティ (W_RECENCY=500、直前プレイ側がいるペアに最大ペナルティ)
 * - 総当たり (matchCount * W_ROUNDROBIN)
 * - 試合数合計 (gamesPlayed合計 * W_BALANCE)
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
    SINGLES_WEIGHT_ROUNDROBIN * matchCount +
    SINGLES_WEIGHT_BALANCE * totalGames +
    SINGLES_WEIGHT_RECENCY * recencyPenalty +
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
 * シングルス用の配置アルゴリズム
 * - 総当たり優先: まだ対戦していない（少ない）ペアを最優先
 * - 試合回数の差を抑制: ペア合算の gamesPlayed が低いほど好まれる
 * - 連続回避: 直前にプレイしたユーザを含むペアにペナルティ
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
  let eligiblePlayers = activePlayers.filter(p => p.gamesPlayed <= avgGames + 3);
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
