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
 * matchHistoryの勝敗に基づいて序列を動的に更新
 * - 勝利: 1つ上に移動
 * - 2連勝ごと: グループ1つ分上に移動
 * - 敗北: 移動なし（勝者の昇格により自然に繰り下がる）
 * groupCount: グループ数（3コート=3, 2コート=2）
 */
export function applyStreakSwaps(
  initialOrder: string[],
  matchHistory: Match[],
  groupCount: number = 3
): string[] {
  const order = [...initialOrder];
  const stepSize = Math.max(1, Math.floor(order.length / groupCount));

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

    // 敗北側はストリークのリセットのみ（移動なし）
    for (const id of losers) {
      streaks.set(id, 0);
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
 * 4人を序列に基づいて最強+最弱ペアリングで2チームに編成
 * 序列順にソートし、1位+4位 vs 2位+3位 を返す
 */
function formTeams(
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

  const ids = sorted.map(p => p.id);

  // 1位+4位 vs 2位+3位（最強+最弱ペア）
  return {
    teamA: [ids[0], ids[3]],
    teamB: [ids[1], ids[2]],
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
  groupingPlayers: Player[],
): CourtAssignment[] {
  // 1. 優先度順にソート（待機時間が長い人を優先）
  const prioritySorted = [...activePlayers].sort((a, b) =>
    calculatePriorityScore(a) - calculatePriorityScore(b)
  );

  // 2. 必要人数を選出（コート数 × 4人）
  const requiredCount = targetCourtIds.length * 4;
  const selected = prioritySorted.slice(0, requiredCount);

  // 3. 全アクティブプレイヤーでグループ分け（グローバル序列）
  const groups = groupPlayers2Court(groupingPlayers, matchHistory);
  const upperIds = groups.get('upper')!;

  // 4. 選ばれたプレイヤーを序列順に並べ替え
  const initialOrder = buildInitialOrder(groupingPlayers);
  const order = applyStreakSwaps(initialOrder, matchHistory, 2);
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

  // 8. チーム編成（序列ベースの最強+最弱ペアリング）
  const upperTeams = formTeams(upperCourt, order);
  const lowerTeams = formTeams(lowerCourt, order);

  return [
    { courtId: sortedCourtIds[0], teamA: upperTeams.teamA, teamB: upperTeams.teamB },
    { courtId: sortedCourtIds[1], teamA: lowerTeams.teamA, teamB: lowerTeams.teamB },
  ];
}

/**
 * 待機時間ベースの優先度を計算
 * 最後の試合終了からの経過時間が長い人ほど優先（値が小さい）
 * レーティング・序列はグループ分け・チーム編成で別途考慮される
 */
function calculatePriorityScore(player: Player): number {
  // まだ1回も試合してない人は最優先（1回保証）
  if (player.gamesPlayed === 0) {
    return -Infinity;
  }

  const now = Date.now();
  const waitingSince = player.lastPlayedAt ?? player.activatedAt ?? now;
  const waitMinutes = (now - waitingSince) / (1000 * 60);

  return -waitMinutes; // 待ちが長い = 値が小さい = 優先度高
}

/**
 * 待機時間順の上位4人を選出し、制約NGなら1人ずつ入替えて有効な4人を探す
 * candidatesは待機時間順（優先スコア昇順）でソート済みの前提
 */
function selectTopFour(
  candidates: Player[],
  matchHistory: Match[],
  groups3: Map<RatingGroup, Set<string>> | null,
  totalCourtCount: number,
): Player[] {
  if (candidates.length <= 4) return candidates;

  const isValid = (ids: string[]): boolean => {
    if (hasSimilarRecentMatch(ids, matchHistory)) return false;
    if (totalCourtCount >= 3 && groups3 && hasIsolatedExtreme(ids, groups3)) return false;
    return true;
  };

  // 上位4人を取る
  const selected = candidates.slice(0, 4);
  if (isValid(selected.map(p => p.id))) return selected;

  // 制約NGなら、優先度の低い方から1人ずつ入替を試みる
  for (let replacePos = 3; replacePos >= 0; replacePos--) {
    const original = selected[replacePos];
    for (let i = 4; i < candidates.length; i++) {
      if (selected.includes(candidates[i])) continue;
      selected[replacePos] = candidates[i];
      if (isValid(selected.map(p => p.id))) return selected;
    }
    selected[replacePos] = original; // 元に戻す
  }

  // 全パターンNG → 制約緩和して上位4人を返す
  return candidates.slice(0, 4);
}

/**
 * 自動配置アルゴリズム v2
 * - 待機時間が長い人を優先（グリーディ選出）
 * - レーティングベースのグルーピング（3等分/2等分）
 * - 確率ベースのコート配置（3コート）/ ホリスティック配置（2コート同時）
 * - 各個人の直近2試合で3人以上の重複を回避
 * - 上位/下位の孤立を回避（3コート）
 */
export function assignCourts(
  players: Player[],
  courtCount: number,
  matchHistory: Match[],
  options?: {
    totalCourtCount?: number;
    targetCourtIds?: number[];
    allPlayers?: Player[];  // 全アクティブプレイヤー（他コートでプレイ中含む）。グループ分けに使用
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

  // グループ分けは全アクティブプレイヤー（他コートでプレイ中含む）で行う
  const groupingPlayers = options?.allPlayers ?? activePlayers;

  // 2コート同時配置の場合はホリスティック・アプローチを使用
  if (totalCourtCount === 2 && courtCount === 2) {
    return assign2CourtsHolistic(activePlayers, targetCourtIds, matchHistory, groupingPlayers);
  }

  // グループ分け（グローバル）
  const groups3 = totalCourtCount >= 3 ? groupPlayers3Court(groupingPlayers, matchHistory) : null;

  // 序列を計算（formTeamsのペアリングに使用）
  const groupCount = totalCourtCount >= 3 ? 3 : 2;
  const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, groupCount);

  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const courtId = targetCourtIds[i];

    // このコートの候補者を集める（prob=0のハード制約で除外）
    const courtCandidates = activePlayers.filter(p => {
      if (usedPlayers.has(p.id)) return false;

      if (totalCourtCount >= 3 && groups3) {
        const group = getPlayerGroup(p.id, groups3);
        const prob = COURT_PROBABILITIES_3[group as RatingGroup]?.[courtId - 1] ?? 0;
        if (prob === 0) return false;
      }

      return true;
    });

    // 優先度でソート（待機時間が長い人を優先）
    courtCandidates.sort((a, b) =>
      calculatePriorityScore(a) - calculatePriorityScore(b)
    );

    // 待機時間順の上位4人を選出（制約NGなら入替）
    let selected: Player[];
    if (courtCandidates.length >= 4) {
      selected = selectTopFour(
        courtCandidates, matchHistory, groups3, totalCourtCount
      );
    } else {
      // 候補者が不足 → グループ制約を緩和して全activeから探索
      const allAvailable = activePlayers
        .filter(p => !usedPlayers.has(p.id))
        .sort((a, b) =>
          calculatePriorityScore(a) - calculatePriorityScore(b)
        );
      selected = selectTopFour(
        allAvailable, matchHistory, groups3, totalCourtCount
      );
    }

    if (selected.length < 4) {
      throw new Error('プレイヤーの割り当てに失敗しました');
    }

    selected.forEach(p => usedPlayers.add(p.id));

    // チーム分け（序列ベースの最強+最弱ペアリング）
    const teams = formTeams(selected, playerOrder);
    assignments.push({ courtId, teamA: teams.teamA, teamB: teams.teamB });
  }

  return assignments;
}

/**
 * 待機メンバーを配置優先度順にソート
 * 空きコートの候補者（確率>0）を上位に、その中で待機時間順
 */
export function sortWaitingPlayers(
  waitingPlayers: Player[],
  options: {
    emptyCourtIds: number[];
    totalCourtCount: number;
    matchHistory: Match[];
    allActivePlayers: Player[];
  }
): Player[] {
  const { emptyCourtIds, totalCourtCount, matchHistory, allActivePlayers } = options;

  // 空きコートがない or 3コート未満 → 優先スコア順のみ
  if (emptyCourtIds.length === 0 || totalCourtCount < 3) {
    return [...waitingPlayers].sort((a, b) =>
      calculatePriorityScore(a) - calculatePriorityScore(b)
    );
  }

  // 3コート: グループ分けしてコート候補者判定
  const groups = groupPlayers3Court(allActivePlayers, matchHistory);
  const isCandidate = new Map<string, boolean>();

  for (const player of waitingPlayers) {
    const group = getPlayerGroup(player.id, groups) as RatingGroup;
    const canPlay = emptyCourtIds.some(courtId => {
      const prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0;
      return prob > 0;
    });
    isCandidate.set(player.id, canPlay);
  }

  return [...waitingPlayers].sort((a, b) => {
    const aCanPlay = isCandidate.get(a.id) ?? true;
    const bCanPlay = isCandidate.get(b.id) ?? true;

    if (aCanPlay !== bCanPlay) {
      return aCanPlay ? -1 : 1;
    }

    return calculatePriorityScore(a) - calculatePriorityScore(b);
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
