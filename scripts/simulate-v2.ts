/**
 * 新配置アルゴリズム シミュレーション v2
 * 3コート、21人、60試合（20ラウンド）
 */

type RatingGroup = 'upper' | 'middle' | 'lower';

interface Player {
  id: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  recentMatches: string[][]; // 直近3試合のメンバー
}

// グループ分け（3コート: 3等分、端数は中位へ）
function groupPlayers3Court(players: Player[]): Map<RatingGroup, Player[]> {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const groupSize = Math.floor(sorted.length / 3);
  const remainder = sorted.length % 3;
  
  const upperSize = groupSize;
  const lowerSize = groupSize;
  const middleSize = groupSize + remainder; // 端数は中位へ
  
  return new Map([
    ['upper', sorted.slice(0, upperSize)],
    ['middle', sorted.slice(upperSize, upperSize + middleSize)],
    ['lower', sorted.slice(upperSize + middleSize)],
  ]);
}

// 配置確率（3コート）
const COURT_PROBABILITIES_3: Record<RatingGroup, number[]> = {
  upper:  [0.50, 0.50, 0.00], // C1, C2, C3
  middle: [0.25, 0.50, 0.25],
  lower:  [0.00, 0.50, 0.50],
};

// 確率に基づいてコートを選択
function selectCourtByProbability(group: RatingGroup): number {
  const probs = COURT_PROBABILITIES_3[group];
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (rand < cumulative) return i + 1;
  }
  return 2; // fallback
}

// 4人中3人が直近3試合で同じかチェック
function hasSimilarRecentMatch(
  fourPlayers: string[],
  player: Player
): boolean {
  for (const recentMatch of player.recentMatches) {
    const overlap = fourPlayers.filter(id => recentMatch.includes(id));
    if (overlap.length >= 3) return true;
  }
  return false;
}

// パターンA: 回数少ない人優先 → 確率でコート決定
function assignPatternA(
  players: Player[],
  groups: Map<RatingGroup, Player[]>,
  usedPlayers: Set<string>
): Map<number, string[]> {
  const assignments = new Map<number, string[]>([
    [1, []], [2, []], [3, []]
  ]);
  
  // 全プレイヤーを回数少ない順にソート
  const available = players
    .filter(p => !usedPlayers.has(p.id))
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed);
  
  for (const player of available) {
    // このプレイヤーのグループを特定
    let playerGroup: RatingGroup = 'middle';
    for (const [group, members] of groups) {
      if (members.some(m => m.id === player.id)) {
        playerGroup = group;
        break;
      }
    }
    
    // 確率でコート選択
    let court = selectCourtByProbability(playerGroup);
    
    // そのコートが満員なら他を試す
    const tryOrder = [court, ...([1, 2, 3].filter(c => c !== court))];
    for (const c of tryOrder) {
      if (assignments.get(c)!.length < 4) {
        // 確率が0のコートはスキップ
        if (COURT_PROBABILITIES_3[playerGroup][c - 1] === 0) continue;
        
        // 直近3試合で3人同じチェック
        const currentMembers = assignments.get(c)!;
        if (currentMembers.length >= 3 && hasSimilarRecentMatch([...currentMembers, player.id], player)) {
          continue; // スキップしてシャッフル
        }
        
        assignments.get(c)!.push(player.id);
        usedPlayers.add(player.id);
        break;
      }
    }
  }
  
  return assignments;
}

// パターンB: 確率でコート決定 → 回数少ない順に選ぶ
function assignPatternB(
  players: Player[],
  groups: Map<RatingGroup, Player[]>,
  usedPlayers: Set<string>
): Map<number, string[]> {
  const assignments = new Map<number, string[]>([
    [1, []], [2, []], [3, []]
  ]);
  
  // 各コートに配置
  for (let courtId = 1; courtId <= 3; courtId++) {
    // このコートに配置可能なプレイヤーを集める（確率>0）
    const eligible: Player[] = [];
    
    for (const [group, members] of groups) {
      if (COURT_PROBABILITIES_3[group][courtId - 1] > 0) {
        eligible.push(...members.filter(m => !usedPlayers.has(m.id)));
      }
    }
    
    // 回数少ない順にソート
    eligible.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
    
    // 4人選ぶ
    for (const player of eligible) {
      if (assignments.get(courtId)!.length >= 4) break;
      
      // 直近3試合で3人同じチェック
      const currentMembers = assignments.get(courtId)!;
      if (currentMembers.length >= 3) {
        if (hasSimilarRecentMatch([...currentMembers, player.id], player)) {
          continue;
        }
      }
      
      assignments.get(courtId)!.push(player.id);
      usedPlayers.add(player.id);
    }
  }
  
  return assignments;
}

// シミュレーション実行
function simulate(
  playerCount: number,
  rounds: number,
  pattern: 'A' | 'B'
) {
  // プレイヤー生成
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: `p${i}`,
      name: `P${String(i + 1).padStart(2, '0')}`,
      rating: 100 + Math.floor(Math.random() * 100),
      gamesPlayed: 0,
      recentMatches: [],
    });
  }
  
  const groups = groupPlayers3Court(players);
  
  console.log(`\n【グループ分け】`);
  for (const [group, members] of groups) {
    const names = members.map(m => `${m.name}(${m.rating})`).join(', ');
    console.log(`  ${group}: ${members.length}人 - ${names}`);
  }
  
  // ラウンドごとに配置
  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();
    
    const assignments = pattern === 'A'
      ? assignPatternA(players, groups, usedPlayers)
      : assignPatternB(players, groups, usedPlayers);
    
    // 結果を記録
    for (const [courtId, memberIds] of assignments) {
      if (memberIds.length === 4) {
        memberIds.forEach(id => {
          const player = players.find(p => p.id === id)!;
          player.gamesPlayed++;
          player.recentMatches.unshift(memberIds);
          if (player.recentMatches.length > 3) {
            player.recentMatches.pop();
          }
        });
      }
    }
  }
  
  // 結果表示
  console.log(`\n【${rounds}ラウンド後の結果 - パターン${pattern}】`);
  
  for (const [group, members] of groups) {
    const games = members.map(m => m.gamesPlayed);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    const min = Math.min(...games);
    const max = Math.max(...games);
    
    console.log(`\n  [${group}グループ]`);
    members.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    members.forEach(m => {
      console.log(`    ${m.name}: ${m.gamesPlayed}回`);
    });
    console.log(`    → 平均: ${avg.toFixed(1)}回, 最小: ${min}, 最大: ${max}, 差: ${max - min}`);
  }
  
  // 全体統計
  const allGames = players.map(p => p.gamesPlayed);
  const totalAvg = allGames.reduce((a, b) => a + b, 0) / allGames.length;
  const totalMin = Math.min(...allGames);
  const totalMax = Math.max(...allGames);
  
  console.log(`\n  [全体]`);
  console.log(`    平均: ${totalAvg.toFixed(1)}回, 最小: ${totalMin}, 最大: ${totalMax}, 差: ${totalMax - totalMin}`);
  
  // 理論値
  const expectedPerPlayer = (rounds * 3 * 4) / playerCount;
  console.log(`    理論値: ${expectedPerPlayer.toFixed(1)}回/人`);
}

console.log('='.repeat(60));
console.log('  3コート、21人、20ラウンド（60試合相当）');
console.log('='.repeat(60));

console.log('\n' + '─'.repeat(60));
console.log('パターンA: 回数少ない人優先 → 確率でコート決定');
console.log('─'.repeat(60));
simulate(21, 20, 'A');

console.log('\n' + '─'.repeat(60));
console.log('パターンB: 確率でコート決定 → 回数少ない人優先');
console.log('─'.repeat(60));
simulate(21, 20, 'B');
