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
 * 各プレイヤーの連勝/連敗数を算出
 * 正の値=連勝数、負の値=連敗数
 */
export function getStreaks(matchHistory: Match[]): Map<string, number> {
  const streaks = new Map<string, number>();

  // matchHistoryは新しい順（先頭が最新）の前提で、古い順に処理する
  const chronological = [...matchHistory].reverse();

  for (const match of chronological) {
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
 */
export function applyStreakSwaps(
  initialOrder: string[],
  matchHistory: Match[],
  groupCount: number = 3
): string[] {
  const order = [...initialOrder];
  const stepSize = Math.max(1, Math.floor(order.length / groupCount));
  const dropAmount = Math.max(1, Math.ceil(stepSize / 2));

  // 古い順に処理
  const chronological = [...matchHistory].reverse();

  // 各プレイヤーの連勝カウント（処理中の累積）
  const streaks = new Map<string, number>();

  for (const match of chronological) {
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
 */
function hasSimilarRecentMatch(
  fourPlayerIds: string[],
  matchHistory: Match[]
): boolean {
  for (const playerId of fourPlayerIds) {
    let found = 0;
    for (const match of matchHistory) {
      if (found >= 3) break;  // 直近3試合をチェック（変更: 2→3）
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
 * プレイヤーが未消化の予約に含まれているかチェック
 * excludeIds: チェック対象から除外する予約ID（すでに消化済みとみなす）
 */
function isPlayerInPendingReservation(
  playerId: string,
  reservations: Reservation[],
  excludeIds: string[]
): boolean {
  return reservations.some(
    r => r.status === 'pending' && !excludeIds.includes(r.id) && r.playerIds.includes(playerId)
  );
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
  useStayDuration: boolean = true
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
    calculatePriorityScore(a, practiceStartTime, useStayDuration) - calculatePriorityScore(b, practiceStartTime, useStayDuration)
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
          calculatePriorityScore(b, practiceStartTime, useStayDuration) -
          calculatePriorityScore(a, practiceStartTime, useStayDuration)
        );
      if (excludable.length > 0) {
        const toExclude = excludable[0];
        const majorityGender = minorityGender === 'F' ? 'M' : 'F';
        const nextMajority = prioritySorted
          .slice(requiredCount)
          .find(p => p.gender === majorityGender);
        if (nextMajority) {
          // フェアネスチェック: 除外候補が入替先より2試合分以上待っていたら除外しない
          const excludePriority = calculatePriorityScore(toExclude, practiceStartTime, useStayDuration);
          const replacePriority = calculatePriorityScore(nextMajority, practiceStartTime, useStayDuration);
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
 */
function calculatePriorityScore(
  player: Player,
  practiceStartTime: number,
  useStayDuration: boolean = true
): number {
  // まだ1回も試合してない人は最優先（1回保証）
  if (player.gamesPlayed === 0) {
    return -Infinity;
  }

  if (!useStayDuration) {
    return player.gamesPlayed * 0.4;
  }

  const now = Date.now();

  // 滞在開始時刻 = max(練習開始日時, 休憩解除時刻)
  const stayStart = Math.max(
    practiceStartTime,
    player.activatedAt ?? now
  );

  // 滞在時間（分）、最低5分
  const stayMinutes = Math.max((now - stayStart) / (1000 * 60), 5);

  return player.gamesPlayed / stayMinutes;
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
  useStayDuration: boolean
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
      (sum, p) => sum + calculatePriorityScore(p, practiceStartTime, useStayDuration),
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
  useStayDuration: boolean
): RatingGroup | null {
  const priorities = calculateGroupPriorities(
    groups, players, usedPlayerIds, practiceStartTime, useStayDuration
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
    const base = calculatePriorityScore(p, practiceStartTime, useStayDuration);
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
  }
): CourtAssignment[] {
  const activePlayers = players.filter((p) => !p.isResting);
  const totalCourtCount = options?.totalCourtCount ?? courtCount;
  const targetCourtIds = options?.targetCourtIds ??
    Array.from({ length: courtCount }, (_, i) => i + 1);
  const practiceStartTime = options?.practiceStartTime ?? Date.now();
  const useStayDuration = options?.useStayDurationPriority ?? true;
  const pendingReservations = (options?.reservations ?? []).filter(r => r.status === 'pending');
  const gameMode = options?.gameMode ?? 'doubles';

  // シングルスモードの場合
  if (gameMode === 'singles') {
    // 予約配置を先に処理
    const singlesReservationAssignments: CourtAssignment[] = [];
    const singlesUsedPlayers = new Set<string>();
    const singlesFulfilledIds: string[] = [];
    const singlesRemainingCourtIds = [...targetCourtIds];

    for (const reservation of pendingReservations) {
      if (singlesRemainingCourtIds.length === 0) break;

      // 予約メンバー全員が待機中か確認
      const reservedPlayers = reservation.playerIds
        .map(id => activePlayers.find(p => p.id === id))
        .filter((p): p is Player => p !== undefined);

      if (reservedPlayers.length !== reservation.playerIds.length) continue;
      if (reservation.playerIds.some(id => singlesUsedPlayers.has(id))) continue;

      const rsvPlayerIds = reservation.playerIds;

      if (rsvPlayerIds.length === 2) {
        // 2人: そのまま対戦
        const courtId = singlesRemainingCourtIds.shift()!;
        singlesReservationAssignments.push({
          courtId,
          teamA: [rsvPlayerIds[0], ''],
          teamB: [rsvPlayerIds[1], ''],
        });
        rsvPlayerIds.forEach(id => singlesUsedPlayers.add(id));
        singlesFulfilledIds.push(reservation.id);
      } else if (rsvPlayerIds.length === 1) {
        // 1人: 相手を通常ロジックで選出
        const nonReserved = activePlayers.filter(
          p => !singlesUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
            && !isPlayerInPendingReservation(p.id, pendingReservations, [...singlesFulfilledIds, reservation.id])
        );
        if (nonReserved.length === 0) continue;
        nonReserved.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );
        const courtId = singlesRemainingCourtIds.shift()!;
        singlesReservationAssignments.push({
          courtId,
          teamA: [rsvPlayerIds[0], ''],
          teamB: [nonReserved[0].id, ''],
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

    // 未消化予約のプレイヤーを除外
    const singlesReservedIds = new Set<string>();
    for (const reservation of pendingReservations) {
      if (singlesFulfilledIds.includes(reservation.id)) continue;
      reservation.playerIds.forEach(id => singlesReservedIds.add(id));
    }

    const singlesNormalCandidates = activePlayers.filter(
      p => !singlesUsedPlayers.has(p.id) && !singlesReservedIds.has(p.id)
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
      singlesNormalCandidates, singlesRemainingCourtIds, matchHistory, practiceStartTime, useStayDuration
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

    // 予約メンバー全員が待機中（activePlayers に含まれ、まだ使われていない）か確認
    const reservedPlayers = reservation.playerIds
      .map(id => activePlayers.find(p => p.id === id))
      .filter((p): p is Player => p !== undefined);

    if (reservedPlayers.length !== reservation.playerIds.length) continue;
    if (reservation.playerIds.some(id => reservationUsedPlayers.has(id))) continue;

    const courtId = remainingCourtIds.shift()!;
    const rsvPlayerIds = reservation.playerIds;

    if (rsvPlayerIds.length === 4) {
      // 4人: 最初の2人 vs 残り2人で固定配置
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [rsvPlayerIds[2], rsvPlayerIds[3]] as [string, string],
      });
    } else if (rsvPlayerIds.length === 3) {
      // 3人: 最初の2人がペア + 3人目と通常ロジックで1人選出
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
          && !isPlayerInPendingReservation(p.id, pendingReservations, [...fulfilledReservationIds, reservation.id])
      );
      if (nonReserved.length === 0) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration)
      );
      const fourth = nonReserved[0];
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [rsvPlayerIds[2], fourth.id] as [string, string],
      });
      reservationUsedPlayers.add(fourth.id);
    } else if (rsvPlayerIds.length === 2) {
      // 2人: 同じチームとして配置 + 残り2人を通常ロジックで選出
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
          && !isPlayerInPendingReservation(p.id, pendingReservations, [...fulfilledReservationIds, reservation.id])
      );
      if (nonReserved.length < 2) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration)
      );
      reservationAssignments.push({
        courtId,
        teamA: [rsvPlayerIds[0], rsvPlayerIds[1]] as [string, string],
        teamB: [nonReserved[0].id, nonReserved[1].id] as [string, string],
      });
      reservationUsedPlayers.add(nonReserved[0].id);
      reservationUsedPlayers.add(nonReserved[1].id);
    } else if (rsvPlayerIds.length === 1) {
      // 1人: 最優先候補として通常ロジックで残り3人を選出
      const nonReserved = activePlayers.filter(
        p => !reservationUsedPlayers.has(p.id) && !rsvPlayerIds.includes(p.id)
          && !isPlayerInPendingReservation(p.id, pendingReservations, [...fulfilledReservationIds, reservation.id])
      );
      if (nonReserved.length < 3) {
        remainingCourtIds.unshift(courtId);
        continue;
      }
      nonReserved.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration)
      );
      const groupingPlayers = options?.allPlayers ?? activePlayers;
      const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, totalCourtCount >= 3 ? 3 : 2);
      const fourPlayers = [
        activePlayers.find(p => p.id === rsvPlayerIds[0])!,
        nonReserved[0], nonReserved[1], nonReserved[2],
      ];
      const teams = formTeams(fourPlayers, playerOrder);
      reservationAssignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
      reservationUsedPlayers.add(nonReserved[0].id);
      reservationUsedPlayers.add(nonReserved[1].id);
      reservationUsedPlayers.add(nonReserved[2].id);
    }

    rsvPlayerIds.forEach(id => reservationUsedPlayers.add(id));
    fulfilledReservationIds.push(reservation.id);
  }

  // 予約で配置されなかった残りのコートを通常ロジックで埋める
  const normalCourtCount = remainingCourtIds.length;

  // 予約専用待機プレイヤー（未消化の予約に含まれるが、まだ配置されていない）を除外
  const reservedPlayerIds = new Set<string>();
  for (const reservation of pendingReservations) {
    if (fulfilledReservationIds.includes(reservation.id)) continue;
    reservation.playerIds.forEach(id => reservedPlayerIds.add(id));
  }

  const normalCandidates = activePlayers.filter(
    p => !reservationUsedPlayers.has(p.id) && !reservedPlayerIds.has(p.id)
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
    const holistic = assign2CourtsHolistic(normalCandidates, remainingCourtIds, matchHistory, practiceStartTime, groupingPlayers, useStayDuration);
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
        groups3, normalCandidates, usedPlayers, practiceStartTime, useStayDuration
      );

      if (!targetGroup) {
        // 全グループが使い切られた or 偏差制限にかかった
        // フォールバック: 残りの全員から選ぶ
        const remaining = normalCandidates.filter(p => !usedPlayers.has(p.id));
        if (remaining.length < 4) break;

        remaining.sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );

        const selected = selectBestFour(
          remaining, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced
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
      const available = normalCandidates.filter(p => !usedPlayers.has(p.id) && !groupMembers.includes(p));

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
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );

        const result = selectBestFour(
          candidates, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced
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
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );
        selected = selectBestFour(
          allAvailable, matchHistory, groups3, totalCourtCount,
          practiceStartTime, useStayDuration, allowUnbalanced
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
      calculatePriorityScore(a, practiceStartTime, useStayDuration) -
      calculatePriorityScore(b, practiceStartTime, useStayDuration)
    );

    // 制約を満たす4人を選択
    const selected = selectBestFour(
      candidatePool, matchHistory, groups3, totalCourtCount,
      practiceStartTime, useStayDuration, allowUnbalanced
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
  }
): Player[] {
  const { practiceStartTime, useStayDuration } = options;

  // 優先度スコア順にソート（低いほど優先）
  return [...waitingPlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration) -
    calculatePriorityScore(b, practiceStartTime, useStayDuration)
  );
}

/**
 * シングルス用の配置アルゴリズム
 * - 総当たり優先: まだ対戦していない相手を優先的にマッチング
 * - 試合回数が均等になるよう、試合数の少ないプレイヤーを優先
 * - 予約等で変動した場合は総当たりの制約を緩和
 */
function assignCourtsSingles(
  activePlayers: Player[],
  targetCourtIds: number[],
  matchHistory: Match[],
  practiceStartTime: number,
  useStayDuration: boolean
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

  // 優先度順にソート（試合回数が少ない人を優先）
  const prioritySorted = [...activePlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration) -
    calculatePriorityScore(b, practiceStartTime, useStayDuration)
  );

  // 多めに候補を選出（総当たり最適化のため）
  const candidateCount = Math.min(activePlayers.length, requiredPlayers + 4);
  const candidates = prioritySorted.slice(0, candidateCount);

  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  for (const courtId of targetCourtIds) {
    const available = candidates.filter(p => !usedPlayers.has(p.id));
    if (available.length < 2) break;

    // 最優先プレイヤーを選出
    const first = available[0];
    usedPlayers.add(first.id);

    // 2人目: まだ対戦していない相手を優先（総当たり）
    const remaining = available.filter(p => p.id !== first.id);
    remaining.sort((a, b) => {
      const countA = getMatchCount(first.id, a.id);
      const countB = getMatchCount(first.id, b.id);
      if (countA !== countB) return countA - countB; // 対戦回数が少ない方を優先
      return calculatePriorityScore(a, practiceStartTime, useStayDuration) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration);
    });

    const second = remaining[0];
    usedPlayers.add(second.id);

    assignments.push({
      courtId,
      teamA: [first.id, ''],
      teamB: [second.id, ''],
    });
  }

  return assignments;
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
