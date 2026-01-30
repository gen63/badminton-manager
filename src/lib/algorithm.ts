import type { Player } from '../types/player';
import type { CourtAssignment } from '../types/court';
import type { Match } from '../types/match';

/**
 * プレイヤーの優先度を計算（数値が小さいほど優先度が高い）
 */
function calculatePriority(player: Player): number {
  const gamesWeight = player.gamesPlayed * 1000;
  const timeWeight = player.lastPlayedAt ? Date.now() - player.lastPlayedAt : 0;
  return gamesWeight - timeWeight;
}

/**
 * ペアの組み合わせ履歴を取得
 */
function getPairHistory(matchHistory: Match[]): Map<string, Set<string>> {
  const pairMap = new Map<string, Set<string>>();

  matchHistory.forEach((match) => {
    // チームA
    const [a1, a2] = match.teamA;
    if (!pairMap.has(a1)) pairMap.set(a1, new Set());
    if (!pairMap.has(a2)) pairMap.set(a2, new Set());
    pairMap.get(a1)!.add(a2);
    pairMap.get(a2)!.add(a1);

    // チームB
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
 * 自動配置アルゴリズム
 * 優先順位:
 * 1. プレイ回数が少ない人
 * 2. 最後にプレイしてから時間が経っている人
 * 3. 同じペアの組み合わせを避ける
 * 4. 同じ対戦相手を避ける
 */
export function assignCourts(
  players: Player[],
  courtCount: number,
  matchHistory: Match[]
): CourtAssignment[] {
  const activePlayers = players.filter((p) => !p.isResting);
  const requiredPlayers = courtCount * 4;

  if (activePlayers.length < requiredPlayers) {
    throw new Error(
      `アクティブなプレイヤーが不足しています（必要: ${requiredPlayers}人、現在: ${activePlayers.length}人）`
    );
  }

  // 優先度順にソート
  const sortedPlayers = [...activePlayers].sort(
    (a, b) => calculatePriority(a) - calculatePriority(b)
  );

  const pairHistory = getPairHistory(matchHistory);
  const opponentHistory = getOpponentHistory(matchHistory);
  const assignments: CourtAssignment[] = [];
  const usedPlayers = new Set<string>();

  // 各コートに割り当て
  for (let i = 0; i < courtCount; i++) {
    const availablePlayers = sortedPlayers.filter(
      (p) => !usedPlayers.has(p.id)
    );

    if (availablePlayers.length < 4) {
      throw new Error('プレイヤーの割り当てに失敗しました');
    }

    // チームA: 最も優先度の高い2人
    const teamA: [string, string] = [
      availablePlayers[0].id,
      availablePlayers[1].id,
    ];

    // チームB: 残りから選択（できるだけ対戦したことがない相手）
    let teamB: [string, string] | null = null;
    let bestScore = Infinity;

    for (let j = 2; j < availablePlayers.length - 1; j++) {
      for (let k = j + 1; k < availablePlayers.length; k++) {
        const p1 = availablePlayers[j];
        const p2 = availablePlayers[k];

        // ペア履歴のスコア（一緒にプレイした回数）
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
      teamB = [availablePlayers[2].id, availablePlayers[3].id];
    }

    assignments.push({
      courtId: i + 1,
      teamA,
      teamB,
    });

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
