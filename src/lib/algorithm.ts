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
 * 直近3試合で4人中3人が同じかチェック
 */
function hasSimilarRecentMatch(
  fourPlayerIds: string[],
  matchHistory: Match[]
): boolean {
  const recent3 = matchHistory.slice(0, 3);
  
  for (const match of recent3) {
    const matchMembers = [...match.teamA, ...match.teamB];
    const overlap = fourPlayerIds.filter(id => matchMembers.includes(id));
    if (overlap.length >= 3) return true;
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
 * 8人を選出 → 序列でupper/lowerに分割 → コートに配置
 */
function assign2CourtsHolistic(
  activePlayers: Player[],
  targetCourtIds: number[],
  matchHistory: Match[],
  practiceStartTime: number
): CourtAssignment[] {
  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);

  // 1. 優先度順にソート
  const prioritySorted = [...activePlayers].sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime) - calculatePriorityScore(b, practiceStartTime)
  );

  // 2. 上位8人を選出
  const selected = prioritySorted.slice(0, 8);

  // 3. 選ばれた8人をストリーク調整済み序列でグループ分け
  const groups = groupPlayers2Court(selected, matchHistory);
  const upperIds = groups.get('upper')!;

  // 4. 序列順に並べ替え
  const initialOrder = buildInitialOrder(selected);
  const order = applyStreakSwaps(initialOrder, matchHistory);
  const orderedSelected = order
    .filter(id => selected.some(p => p.id === id))
    .map(id => selected.find(p => p.id === id)!);

  // 5. upper/lowerコートに振り分け
  const upperCourt: Player[] = [];
  const lowerCourt: Player[] = [];

  for (const player of orderedSelected) {
    if (upperIds.has(player.id) && upperCourt.length < 4) {
      upperCourt.push(player);
    } else if (!upperIds.has(player.id) && lowerCourt.length < 4) {
      lowerCourt.push(player);
    } else if (upperCourt.length < 4) {
      upperCourt.push(player);
    } else {
      lowerCourt.push(player);
    }
  }

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
 * - 直近3試合で3人同じを回避
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
  practiceStartTime: number
): number {
  const now = Date.now();
  
  // 滞在開始時刻 = max(練習開始日時, 休憩解除時刻)
  const stayStart = Math.max(
    practiceStartTime,
    player.activatedAt ?? now
  );
  
  // 滞在時間（分）、最低5分
  const stayMinutes = Math.max((now - stayStart) / (1000 * 60), 5);
  
  // まだ1回も試合してない人は最優先（1回保証）
  if (player.gamesPlayed === 0) {
    return -Infinity;
  }
  
  return player.gamesPlayed / stayMinutes;
}

export function assignCourts(
  players: Player[],
  courtCount: number,
  matchHistory: Match[],
  options?: {
    totalCourtCount?: number;
    targetCourtIds?: number[];
    practiceStartTime?: number;
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

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && courtCount === 2) {
    return assign2CourtsHolistic(activePlayers, targetCourtIds, matchHistory, practiceStartTime);
  }

  // グループ分け
  const groups3 = totalCourtCount >= 3 ? groupPlayers3Court(activePlayers, matchHistory) : null;
  const groups2 = totalCourtCount === 2 ? groupPlayers2Court(activePlayers, matchHistory) : null;

  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);
  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const courtId = targetCourtIds[i];

    // このコートに配置可能なプレイヤーを集める
    const eligible = activePlayers.filter(p => {
      if (usedPlayers.has(p.id)) return false;
      
      if (totalCourtCount >= 3 && groups3) {
        const group = getPlayerGroup(p.id, groups3);
        const prob = COURT_PROBABILITIES_3[group as RatingGroup]?.[courtId - 1] ?? 0;
        if (prob === 0) return false;
        // 確率に基づいてランダムで除外（ランダム性を持たせる）
        if (Math.random() > prob * 1.5) return false;
      } else if (totalCourtCount === 2 && groups2) {
        const group = getPlayerGroup(p.id, groups2);
        const prob = COURT_PROBABILITIES_2[group as 'upper' | 'lower']?.[courtId - 1] ?? 0.5;
        if (Math.random() > prob * 1.3) return false;
      }
      
      return true;
    });

    // 滞在時間ベースの優先度でソート（スコアが低い人を優先）
    eligible.sort((a, b) => 
      calculatePriorityScore(a, practiceStartTime) - calculatePriorityScore(b, practiceStartTime)
    );

    // 4人選ぶ
    const selected: Player[] = [];
    
    for (const player of eligible) {
      if (selected.length >= 4) break;
      
      const testIds = [...selected.map(p => p.id), player.id];
      
      // 直近3試合で3人同じチェック
      if (selected.length >= 3) {
        if (hasSimilarRecentMatch(testIds, matchHistory)) {
          continue;
        }
      }
      
      // 上位/下位の孤立チェック（3コートの場合、4人目の時）
      if (totalCourtCount >= 3 && groups3 && testIds.length === 4) {
        if (hasIsolatedExtreme(testIds, groups3)) {
          continue;
        }
      }
      
      selected.push(player);
      usedPlayers.add(player.id);
    }

    // 制約で4人揃わなかった場合、フォールバック
    if (selected.length < 4) {
      const remaining = activePlayers
        .filter(p => !usedPlayers.has(p.id))
        .sort((a, b) => 
          calculatePriorityScore(a, practiceStartTime) - calculatePriorityScore(b, practiceStartTime)
        );
      
      for (const player of remaining) {
        if (selected.length >= 4) break;
        selected.push(player);
        usedPlayers.add(player.id);
      }
    }

    if (selected.length < 4) {
      throw new Error('プレイヤーの割り当てに失敗しました');
    }

    // チーム分け（ペア履歴・対戦履歴を考慮）
    const teamA: [string, string] = [selected[0].id, selected[1].id];
    let teamB: [string, string] | null = null;
    let bestScore = Infinity;

    // 残り2人でチームBを組む（組み合わせを探索）
    for (let j = 0; j < 2; j++) {
      for (let k = j + 1; k < 4; k++) {
        if (j < 2 && k < 2) continue; // teamAの組み合わせはスキップ
        
        const candidate = [selected[j === 0 ? 2 : j === 1 ? 3 : j], selected[k === 2 ? 3 : k]];
        if (!candidate[0] || !candidate[1]) continue;
        
        const p1 = selected[2];
        const p2 = selected[3];
        
        // スコア計算
        let score = 0;
        if (pairHistory.get(p1.id)?.has(p2.id)) score += 10;
        teamA.forEach((aId) => {
          if (opponentHistory.get(p1.id)?.has(aId)) score += 5;
          if (opponentHistory.get(p2.id)?.has(aId)) score += 5;
        });
        
        if (score < bestScore) {
          bestScore = score;
          teamB = [p1.id, p2.id];
        }
      }
    }

    if (!teamB) {
      teamB = [selected[2].id, selected[3].id];
    }

    assignments.push({ courtId, teamA, teamB });
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
