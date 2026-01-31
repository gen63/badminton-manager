import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';

const DEFAULT_RATING = 1500;

type RatingGroup = 'upper' | 'middle' | 'lower';

/**
 * プレイヤーの優先度を計算（数値が小さいほど優先度が高い）
 */
function calculatePriority(player: Player): number {
  const gamesWeight = player.gamesPlayed * 1000;
  const timeWeight = player.lastPlayedAt ? Date.now() - player.lastPlayedAt : 0;
  return gamesWeight - timeWeight;
}

/**
 * プレイヤーのレーティングを取得（未設定はデフォルト値）
 */
function getRating(player: Player): number {
  return player.rating ?? DEFAULT_RATING;
}

/**
 * プレイヤーをレーティングでグループ分け
 * @param players 全プレイヤー
 * @param totalCourtCount 全コート数
 * @returns グループ分けされたプレイヤーマップ
 */
function groupPlayersByRating(
  players: Player[],
  totalCourtCount: number
): Map<RatingGroup, Set<string>> {
  const groups = new Map<RatingGroup, Set<string>>([
    ['upper', new Set()],
    ['middle', new Set()],
    ['lower', new Set()],
  ]);

  if (totalCourtCount === 1) {
    // 1コートの場合はグルーピングなし（全員middle扱い）
    players.forEach((p) => groups.get('middle')!.add(p.id));
    return groups;
  }

  // レーティングでソート（高い順）
  const sortedByRating = [...players].sort(
    (a, b) => getRating(b) - getRating(a)
  );

  // 上位4人、下位4人、それ以外
  sortedByRating.forEach((player, index) => {
    // レーティング未設定は中位グループ
    if (player.rating === undefined) {
      groups.get('middle')!.add(player.id);
    } else if (index < 4) {
      groups.get('upper')!.add(player.id);
    } else if (index >= sortedByRating.length - 4) {
      groups.get('lower')!.add(player.id);
    } else {
      groups.get('middle')!.add(player.id);
    }
  });

  return groups;
}

/**
 * コートIDに対して配置可能なグループを取得
 * - 3コート: コート1→上位+中位、コート2→全グループ、コート3→中位+下位
 * - 2コート: コート1→上位+中位、コート2→中位+下位
 * - 1コート: 全員
 */
function getAllowedGroupsForCourt(
  courtId: number,
  totalCourtCount: number
): RatingGroup[] {
  if (totalCourtCount === 1) {
    return ['upper', 'middle', 'lower'];
  }

  if (totalCourtCount === 2) {
    if (courtId === 1) return ['upper', 'middle'];
    if (courtId === 2) return ['middle', 'lower'];
  }

  if (totalCourtCount === 3) {
    if (courtId === 1) return ['upper', 'middle'];
    if (courtId === 2) return ['upper', 'middle', 'lower'];
    if (courtId === 3) return ['middle', 'lower'];
  }

  // デフォルト
  return ['upper', 'middle', 'lower'];
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
    const teamA = match.teamA;
    const teamB = match.teamB;

    teamA.forEach((playerId) => {
      if (!opponentMap.has(playerId)) opponentMap.set(playerId, new Set());
      teamB.forEach((opId) => opponentMap.get(playerId)!.add(opId));
    });

    teamB.forEach((playerId) => {
      if (!opponentMap.has(playerId)) opponentMap.set(playerId, new Set());
      teamA.forEach((opId) => opponentMap.get(playerId)!.add(opId));
    });
  });

  return opponentMap;
}

/**
 * 自動配置アルゴリズム（レーティングベースのグルーピング対応）
 */
export function assignCourts(
  players: Player[],
  courtCount: number,
  matchHistory: Match[],
  options?: {
    totalCourtCount?: number;
    targetCourtIds?: number[];
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

  // レーティングでグループ分け
  const ratingGroups = groupPlayersByRating(activePlayers, totalCourtCount);

  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);
  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const courtId = targetCourtIds[i];
    const allowedGroups = getAllowedGroupsForCourt(courtId, totalCourtCount);

    // このコートに配置可能なプレイヤーをフィルタ
    const eligiblePlayers = activePlayers.filter((p) => {
      if (usedPlayers.has(p.id)) return false;
      // いずれかの許可グループに属しているか
      return allowedGroups.some((group) => ratingGroups.get(group)!.has(p.id));
    });

    if (eligiblePlayers.length < 4) {
      // グループ制限で足りない場合は全員から選ぶ（フォールバック）
      const fallbackPlayers = activePlayers.filter((p) => !usedPlayers.has(p.id));
      if (fallbackPlayers.length < 4) {
        throw new Error('プレイヤーの割り当てに失敗しました');
      }
      // フォールバック時は優先度順
      const sorted = [...fallbackPlayers].sort(
        (a, b) => calculatePriority(a) - calculatePriority(b)
      );
      const teamA: [string, string] = [sorted[0].id, sorted[1].id];
      const teamB: [string, string] = [sorted[2].id, sorted[3].id];
      
      assignments.push({ courtId, teamA, teamB });
      [teamA[0], teamA[1], teamB[0], teamB[1]].forEach((id) => usedPlayers.add(id));
      continue;
    }

    // 優先度順にソート（プレイ回数少ない人優先）
    const sortedPlayers = [...eligiblePlayers].sort(
      (a, b) => calculatePriority(a) - calculatePriority(b)
    );

    // チームA: 最も優先度の高い2人
    const teamA: [string, string] = [
      sortedPlayers[0].id,
      sortedPlayers[1].id,
    ];

    // チームB: 残りから選択（ペア履歴・対戦履歴を考慮）
    let teamB: [string, string] | null = null;
    let bestScore = Infinity;

    for (let j = 2; j < sortedPlayers.length - 1; j++) {
      for (let k = j + 1; k < sortedPlayers.length; k++) {
        const p1 = sortedPlayers[j];
        const p2 = sortedPlayers[k];

        // ペア履歴のスコア
        const pairScore = pairHistory.get(p1.id)?.has(p2.id) ? 10 : 0;

        // 対戦履歴のスコア
        let opponentScore = 0;
        teamA.forEach((aId) => {
          if (opponentHistory.get(p1.id)?.has(aId)) opponentScore += 5;
          if (opponentHistory.get(p2.id)?.has(aId)) opponentScore += 5;
        });

        const totalScore = pairScore + opponentScore;

        if (totalScore < bestScore) {
          bestScore = totalScore;
          teamB = [p1.id, p2.id];
        }
      }
    }

    if (!teamB) {
      teamB = [sortedPlayers[2].id, sortedPlayers[3].id];
    }

    assignments.push({ courtId, teamA, teamB });
    usedPlayers.add(teamA[0]);
    usedPlayers.add(teamA[1]);
    usedPlayers.add(teamB[0]);
    usedPlayers.add(teamB[1]);
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
