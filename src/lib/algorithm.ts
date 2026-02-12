import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';

type RatingGroup = 'upper' | 'middle' | 'lower';

// 配置確率（3コート）- upper→C1, middle→C2, lower→C3 固定
const COURT_PROBABILITIES_3: Record<RatingGroup, number[]> = {
  upper:  [1.00, 0.00, 0.00], // C1 固定
  middle: [0.00, 1.00, 0.00], // C2 固定
  lower:  [0.00, 0.00, 1.00], // C3 固定
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
 * ペアがMF（男女混合）かどうかを判定
 */
function isMixedPair(p1: Player, p2: Player): boolean {
  if (!p1.gender || !p2.gender) return false;
  return p1.gender !== p2.gender;
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
  // 4-0, 0-4 (同性対決) or 2-2 (MIX) → ペナルティなし
  // 3-1, 1-3 → MIXにも同性にもならない → 小ペナルティ
  if (maleCount === 1 || maleCount === 3) {
    return oneGameDelta * 0.5;
  }
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
 * 自動配置アルゴリズム v2
 * - レーティングベースのグルーピング（3等分/2等分）
 * - 確率ベースのコート配置（3コート）/ ホリスティック配置（2コート同時）
 * - 各個人の直近2試合で3人以上の重複を回避
 * - 上位/下位の孤立を回避（3コート）
 * - プレイ回数少ない人を優先
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

  // 序列を計算（formTeamsのペアリングに使用）
  const groupCount = totalCourtCount >= 3 ? 3 : 2;
  const playerOrder = applyStreakSwaps(buildInitialOrder(groupingPlayers), matchHistory, groupCount);

  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const courtId = targetCourtIds[i];

    // コート適性ペナルティを計算するヘルパー
    const now = Date.now();
    const buildCourtPenalties = (players: Player[]): Map<string, number> => {
      const penalties = new Map<string, number>();
      for (const p of players) {
        if (p.gamesPlayed === 0) continue;
        let prob = 0.5;
        if (totalCourtCount >= 3 && groups3) {
          const group = getPlayerGroup(p.id, groups3) as RatingGroup;
          prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0.5;
        } else if (totalCourtCount === 2 && groups2) {
          const group = getPlayerGroup(p.id, groups2) as 'upper' | 'lower';
          prob = COURT_PROBABILITIES_2[group]?.[courtId - 1] ?? 0.5;
        }
        if (useStayDuration) {
          const stayStart = Math.max(practiceStartTime, p.activatedAt ?? now);
          const stayMinutes = Math.max((now - stayStart) / (1000 * 60), 5);
          const oneGameDelta = 1 / stayMinutes;
          penalties.set(p.id, Math.random() * (1 - prob) * oneGameDelta);
        } else {
          penalties.set(p.id, Math.random() * 0.8);
        }
      }
      return penalties;
    };

    // homeグループ: このコートに配置可能なプレイヤー（prob>0）
    const homeGroup = activePlayers.filter(p => {
      if (usedPlayers.has(p.id)) return false;
      if (totalCourtCount >= 3 && groups3) {
        const group = getPlayerGroup(p.id, groups3);
        const prob = COURT_PROBABILITIES_3[group as RatingGroup]?.[courtId - 1] ?? 0;
        if (prob === 0) return false;
      }
      return true;
    });

    // 隣接グループの借用候補を序列境界順で構築（3コート固定時）
    const adjacentCandidates: Player[] = [];
    if (totalCourtCount >= 3 && groups3) {
      const courtGroup = courtId === 1 ? 'upper' : courtId === 2 ? 'middle' : 'lower';
      const available = activePlayers.filter(p => !usedPlayers.has(p.id) && !homeGroup.includes(p));

      if (courtGroup === 'upper') {
        // middle上位（序列でupperに近い順）
        const middlePlayers = available.filter(p => groups3.get('middle')!.has(p.id));
        // playerOrder内の位置で序列順にソート
        middlePlayers.sort((a, b) => playerOrder.indexOf(a.id) - playerOrder.indexOf(b.id));
        adjacentCandidates.push(...middlePlayers);
      } else if (courtGroup === 'lower') {
        // middle下位（序列でlowerに近い順 = 序列逆順）
        const middlePlayers = available.filter(p => groups3.get('middle')!.has(p.id));
        middlePlayers.sort((a, b) => playerOrder.indexOf(b.id) - playerOrder.indexOf(a.id));
        adjacentCandidates.push(...middlePlayers);
      } else {
        // middle: upper下位 + lower上位 交互
        const upperPlayers = available.filter(p => groups3.get('upper')!.has(p.id));
        upperPlayers.sort((a, b) => playerOrder.indexOf(b.id) - playerOrder.indexOf(a.id)); // 下位から
        const lowerPlayers = available.filter(p => groups3.get('lower')!.has(p.id));
        lowerPlayers.sort((a, b) => playerOrder.indexOf(a.id) - playerOrder.indexOf(b.id)); // 上位から
        const maxLen = Math.max(upperPlayers.length, lowerPlayers.length);
        for (let j = 0; j < maxLen; j++) {
          if (j < upperPlayers.length) adjacentCandidates.push(upperPlayers[j]);
          if (j < lowerPlayers.length) adjacentCandidates.push(lowerPlayers[j]);
        }
      }
    }

    // 段階的に候補を拡大して探索
    let selected: Player[] | null = null;

    for (let expand = 0; expand <= adjacentCandidates.length; expand++) {
      const candidates = [...homeGroup];
      if (expand > 0) {
        candidates.push(...adjacentCandidates.slice(0, expand));
      }

      if (candidates.length < 4) continue;

      // 優先度でソート
      candidates.sort((a, b) =>
        calculatePriorityScore(a, practiceStartTime, useStayDuration) -
        calculatePriorityScore(b, practiceStartTime, useStayDuration)
      );

      const courtPenalties = buildCourtPenalties(candidates);

      const result = selectBestFour(
        candidates, matchHistory, groups3, totalCourtCount,
        practiceStartTime, useStayDuration, courtPenalties
      );

      // selectBestFourが制約を満たす組を見つけたか確認
      const resultIds = result.map(p => p.id);
      const isValidResult = !hasSimilarRecentMatch(resultIds, matchHistory);

      if (isValidResult) {
        selected = result;
        break;
      }

      // expand=0 で制約緩和結果が返ってきた場合、借用で改善を試みる
      if (expand === adjacentCandidates.length) {
        // 最終フォールバック: 制約緩和結果をそのまま使用
        selected = result;
      }
    }

    if (!selected) {
      // 全候補でも4人見つからない場合
      const allAvailable = activePlayers
        .filter(p => !usedPlayers.has(p.id))
        .sort((a, b) =>
          calculatePriorityScore(a, practiceStartTime, useStayDuration) -
          calculatePriorityScore(b, practiceStartTime, useStayDuration)
        );
      selected = selectBestFour(
        allAvailable, matchHistory, groups3, totalCourtCount,
        practiceStartTime, useStayDuration
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
      return prob >= 0.5;
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
