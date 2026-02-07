import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';

type RatingGroup = 'upper' | 'middle' | 'lower';

// 配置確率（3コート）
const COURT_PROBABILITIES_3: Record<RatingGroup, number[]> = {
  upper:  [0.00, 0.50, 0.50], // C1, C2, C3
  middle: [0.25, 0.50, 0.25],
  lower:  [0.50, 0.00, 0.50],
};

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
 * matchHistoryの連勝/連敗に基づいて序列を動的に更新
 * 二連勝で1つ上と交代、二連敗で1つ下と交代
 */
export function applyStreakSwaps(
  initialOrder: string[],
  matchHistory: Match[]
): string[] {
  const order = [...initialOrder];

  // 古い順に処理
  const chronological = [...matchHistory].reverse();

  // 各プレイヤーの連勝/連敗カウント（処理中の累積）
  const streaks = new Map<string, number>();

  for (const match of chronological) {
    const winners = match.winner === 'A' ? match.teamA : match.teamB;
    const losers = match.winner === 'A' ? match.teamB : match.teamA;

    for (const id of winners) {
      const prev = streaks.get(id) ?? 0;
      const newStreak = prev > 0 ? prev + 1 : 1;
      streaks.set(id, newStreak);

      // 二連勝ごとに1つ上と交代
      if (newStreak >= 2 && newStreak % 2 === 0) {
        const idx = order.indexOf(id);
        if (idx > 0) {
          [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        }
      }
    }

    for (const id of losers) {
      const prev = streaks.get(id) ?? 0;
      const newStreak = prev < 0 ? prev - 1 : -1;
      streaks.set(id, newStreak);

      // 二連敗ごとに1つ下と交代
      if (newStreak <= -2 && newStreak % 2 === 0) {
        const idx = order.indexOf(id);
        if (idx >= 0 && idx < order.length - 1) {
          [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        }
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
  const order = applyStreakSwaps(initialOrder, matchHistory);

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
  const order = applyStreakSwaps(initialOrder, matchHistory);

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
 * プレイヤーのグループを取得
 */
function getPlayerGroup(
  playerId: string,
  groups: Map<string, Set<string>>
): string {
  for (const [group, members] of groups) {
    if (members.has(playerId)) return group;
  }
  return 'middle';
}

/**
 * 候補4人それぞれの直近2試合と、4人中3人以上が重複するかチェック
 * グローバル直近N試合ではなく、各個人の視点で判定する
 */
function hasSimilarRecentMatch(
  fourPlayerIds: string[],
  matchHistory: Match[]
): boolean {
  for (const playerId of fourPlayerIds) {
    let found = 0;
    for (const match of matchHistory) {
      if (found >= 2) break;
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
 * ペアの組み合わせ履歴を取得
 */
function getPairHistory(matchHistory: Match[]): Map<string, Set<string>> {
  const pairMap = new Map<string, Set<string>>();

  matchHistory.forEach((match) => {
    const [a1, a2] = match.teamA;
    if (!pairMap.has(a1)) pairMap.set(a1, new Set());
    if (!pairMap.has(a2)) pairMap.set(a2, new Set());
    pairMap.get(a1)!.add(a2);
    pairMap.get(a2)!.add(a1);

    const [b1, b2] = match.teamB;
    if (!pairMap.has(b1)) pairMap.set(b1, new Set());
    if (!pairMap.has(b2)) pairMap.set(b2, new Set());
    pairMap.get(b1)!.add(b2);
    pairMap.get(b2)!.add(b1);
  });

  return pairMap;
}

/**
 * 対戦履歴を取得
 */
function getOpponentHistory(matchHistory: Match[]): Map<string, Set<string>> {
  const opponentMap = new Map<string, Set<string>>();

  matchHistory.forEach((match) => {
    match.teamA.forEach((playerId) => {
      if (!opponentMap.has(playerId)) opponentMap.set(playerId, new Set());
      match.teamB.forEach((opId) => opponentMap.get(playerId)!.add(opId));
    });

    match.teamB.forEach((playerId) => {
      if (!opponentMap.has(playerId)) opponentMap.set(playerId, new Set());
      match.teamA.forEach((opId) => opponentMap.get(playerId)!.add(opId));
    });
  });

  return opponentMap;
}

/**
 * 4人からペア履歴・対戦履歴を考慮して最適な2チームを編成
 * 全3パターン（AB vs CD, AC vs BD, AD vs BC）を探索
 */
function formTeams(
  fourPlayers: Player[],
  pairHistory: Map<string, Set<string>>,
  opponentHistory: Map<string, Set<string>>
): { teamA: [string, string]; teamB: [string, string] } {
  const ids = fourPlayers.map(p => p.id);

  const splits: [number, number, number, number][] = [
    [0, 1, 2, 3],
    [0, 2, 1, 3],
    [0, 3, 1, 2],
  ];

  let bestA: [string, string] = [ids[0], ids[1]];
  let bestB: [string, string] = [ids[2], ids[3]];
  let bestScore = Infinity;

  for (const [a1, a2, b1, b2] of splits) {
    let score = 0;
    // ペア履歴ペナルティ
    if (pairHistory.get(ids[a1])?.has(ids[a2])) score += 10;
    if (pairHistory.get(ids[b1])?.has(ids[b2])) score += 10;
    // 対戦履歴ペナルティ
    if (opponentHistory.get(ids[a1])?.has(ids[b1])) score += 5;
    if (opponentHistory.get(ids[a1])?.has(ids[b2])) score += 5;
    if (opponentHistory.get(ids[a2])?.has(ids[b1])) score += 5;
    if (opponentHistory.get(ids[a2])?.has(ids[b2])) score += 5;

    if (score < bestScore) {
      bestScore = score;
      bestA = [ids[a1], ids[a2]];
      bestB = [ids[b1], ids[b2]];
    }
  }

  return { teamA: bestA, teamB: bestB };
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
  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);

  // 1. 優先度順にソート
  const prioritySorted = [...activePlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDuration) - calculatePriorityScore(b, practiceStartTime, useStayDuration)
  );

  // 2. 必要人数を選出（コート数 × 4人）
  const requiredCount = targetCourtIds.length * 4;
  const selected = prioritySorted.slice(0, requiredCount);

  // 3. 全アクティブプレイヤーでグループ分け（グローバル序列）
  const groups = groupPlayers2Court(groupingPlayers, matchHistory);
  const upperIds = groups.get('upper')!;

  // 4. 選ばれたプレイヤーを序列順に並べ替え
  const initialOrder = buildInitialOrder(groupingPlayers);
  const order = applyStreakSwaps(initialOrder, matchHistory);
  const orderedSelected = order
    .filter(id => selected.some(p => p.id === id))
    .map(id => selected.find(p => p.id === id)!);

  // 5. 確率ベースのコート振り分け
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

  // 8. チーム編成
  const upperTeams = formTeams(upperCourt, pairHistory, opponentHistory);
  const lowerTeams = formTeams(lowerCourt, pairHistory, opponentHistory);

  return [
    { courtId: sortedCourtIds[0], teamA: upperTeams.teamA, teamB: upperTeams.teamB },
    { courtId: sortedCourtIds[1], teamA: lowerTeams.teamA, teamB: lowerTeams.teamB },
  ];
}

/**
 * 自動配置アルゴリズム v2
 * - レーティングベースのグルーピング（3等分/2等分）
 * - 確率ベースのコート配置（3コート）/ ホリスティック配置（2コート同時）
 * - 各個人の直近2試合で3人以上の重複を回避
 * - 上位/下位の孤立を回避（3コート）
 * - プレイ回数少ない人を優先
 */
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
    return player.gamesPlayed;
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
  courtPenalties?: Map<string, number>,
): Player[] {
  if (candidates.length <= 4) return candidates;

  // candidatesは優先スコア昇順でソート済みの前提
  const isValid = (ids: string[]): boolean => {
    if (hasSimilarRecentMatch(ids, matchHistory)) return false;
    if (totalCourtCount >= 3 && groups3 && hasIsolatedExtreme(ids, groups3)) return false;
    return true;
  };

  const playerScore = (p: Player): number => {
    const base = calculatePriorityScore(p, practiceStartTime, useStayDuration);
    if (base === -Infinity) return -1e9; // 有限値にして複数の未プレイ者を含む組の比較を可能にする
    return base + (courtPenalties?.get(p.id) ?? 0);
  };

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

          const s = combo.reduce((sum, p) => sum + playerScore(p), 0);

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
  }
): CourtAssignment[] {
  const activePlayers = players.filter((p) => !p.isResting);
  const requiredPlayers = courtCount * 4;

  if (activePlayers.length < requiredPlayers) {
    throw new Error(
      `アクティブなプレイヤーが不足しています（必要: ${requiredPlayers}人、現在: ${activePlayers.length}人）`
    );
  }

  const totalCourtCount = options?.totalCourtCount ?? courtCount;
  const targetCourtIds = options?.targetCourtIds ??
    Array.from({ length: courtCount }, (_, i) => i + 1);
  const practiceStartTime = options?.practiceStartTime ?? Date.now();
  const useStayDuration = options?.useStayDurationPriority ?? true;

  // グループ分けは全アクティブプレイヤー（他コートでプレイ中含む）で行う
  const groupingPlayers = options?.allPlayers ?? activePlayers;

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && courtCount === 2) {
    return assign2CourtsHolistic(activePlayers, targetCourtIds, matchHistory, practiceStartTime, groupingPlayers, useStayDuration);
  }

  // グループ分け（グローバル）
  const groups3 = totalCourtCount >= 3 ? groupPlayers3Court(groupingPlayers, matchHistory) : null;
  const groups2 = totalCourtCount === 2 ? groupPlayers2Court(groupingPlayers, matchHistory) : null;

  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);
  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const courtId = targetCourtIds[i];

    // このコートに配置可能なプレイヤーを集める（prob=0のハード制約のみ）
    const eligible = activePlayers.filter(p => {
      if (usedPlayers.has(p.id)) return false;

      if (totalCourtCount >= 3 && groups3) {
        const group = getPlayerGroup(p.id, groups3);
        const prob = COURT_PROBABILITIES_3[group as RatingGroup]?.[courtId - 1] ?? 0;
        if (prob === 0) return false;
      }

      return true;
    });

    // コート適性ペナルティを計算
    // 1試合分の優先スコア差を基準にスケーリングし、1試合差以内なら入替を許容
    const courtPenalties = new Map<string, number>();
    const now = Date.now();
    for (const p of eligible) {
      if (p.gamesPlayed === 0) continue; // 未プレイは最優先を保証
      let prob = 0.5; // デフォルト（1コート等）
      if (totalCourtCount >= 3 && groups3) {
        const group = getPlayerGroup(p.id, groups3) as RatingGroup;
        prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0.5;
      } else if (totalCourtCount === 2 && groups2) {
        const group = getPlayerGroup(p.id, groups2) as 'upper' | 'lower';
        prob = COURT_PROBABILITIES_2[group]?.[courtId - 1] ?? 0.5;
      }
      // 1試合分の優先スコア差でスケーリング（OFF: 1.0、ON: 1/滞在分）
      let oneGameDelta = 1.0;
      if (useStayDuration) {
        const stayStart = Math.max(practiceStartTime, p.activatedAt ?? now);
        const stayMinutes = Math.max((now - stayStart) / (1000 * 60), 5);
        oneGameDelta = 1 / stayMinutes;
      }
      courtPenalties.set(p.id, Math.random() * (1 - prob) * oneGameDelta);
    }

    // 優先度でソート（スコアが低い人を優先）
    eligible.sort((a, b) =>
      calculatePriorityScore(a, practiceStartTime, useStayDuration) - calculatePriorityScore(b, practiceStartTime, useStayDuration)
    );

    // 組み合わせ探索で最適な4人を選出
    let selected: Player[];
    if (eligible.length >= 4) {
      selected = selectBestFour(
        eligible, matchHistory, groups3, totalCourtCount,
        practiceStartTime, useStayDuration, courtPenalties
      );
    } else {
      // eligibleが不足 → グループ制約を緩和して全activeから探索
      const allAvailable = activePlayers
        .filter(p => !usedPlayers.has(p.id))
        .sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );
      selected = selectBestFour(
        allAvailable, matchHistory, groups3, totalCourtCount,
        practiceStartTime, useStayDuration, courtPenalties
      );
    }

    if (selected.length < 4) {
      throw new Error('プレイヤーの割り当てに失敗しました');
    }

    selected.forEach(p => usedPlayers.add(p.id));

    // チーム分け（ペア履歴・対戦履歴を考慮）
    const teams = formTeams(selected, pairHistory, opponentHistory);
    assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
  }

  return assignments;
}

/**
 * 待機メンバーを配置優先度順にソート
 * 空きコートに対してeligible（確率>0）な人を上位に、その中で優先スコア昇順
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
  const { emptyCourtIds, totalCourtCount, matchHistory, allActivePlayers, practiceStartTime, useStayDuration } = options;

  // 空きコートがない or 3コート未満 → 優先スコア順のみ
  if (emptyCourtIds.length === 0 || totalCourtCount < 3) {
    return [...waitingPlayers].sort((a, b) =>
      calculatePriorityScore(a, practiceStartTime, useStayDuration) -
      calculatePriorityScore(b, practiceStartTime, useStayDuration)
    );
  }

  // 3コート: グループ分けしてeligibility判定
  const groups = groupPlayers3Court(allActivePlayers, matchHistory);
  const eligibility = new Map<string, boolean>();

  for (const player of waitingPlayers) {
    const group = getPlayerGroup(player.id, groups) as RatingGroup;
    const eligible = emptyCourtIds.some(courtId => {
      const prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0;
      return prob > 0;
    });
    eligibility.set(player.id, eligible);
  }

  return [...waitingPlayers].sort((a, b) => {
    const aEligible = eligibility.get(a.id) ?? true;
    const bEligible = eligibility.get(b.id) ?? true;

    if (aEligible !== bEligible) {
      return aEligible ? -1 : 1;
    }

    return calculatePriorityScore(a, practiceStartTime, useStayDuration) -
           calculatePriorityScore(b, practiceStartTime, useStayDuration);
  });
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
