/**
 * 新配置アルゴリズム シミュレーション v3
 * 追加制約: 上位と下位が同時にいる場合、どちらか1人だけはNG
 */

type RatingGroup = 'upper' | 'middle' | 'lower';

interface Player {
  id: string;
  name: string;
  rating: number;
  group: RatingGroup;
  gamesPlayed: number;
  recentMatches: string[][];
}

// グループ分け（3コート: 3等分、端数は中位へ）
function groupPlayers3Court(players: Player[]): void {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const groupSize = Math.floor(sorted.length / 3);
  const remainder = sorted.length % 3;
  
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;
  
  sorted.forEach((p, i) => {
    const player = players.find(pl => pl.id === p.id)!;
    if (i < upperSize) {
      player.group = 'upper';
    } else if (i < upperSize + middleSize) {
      player.group = 'middle';
    } else {
      player.group = 'lower';
    }
  });
}

// 配置確率（3コート）
const COURT_PROBABILITIES_3: Record<RatingGroup, number[]> = {
  upper:  [0.50, 0.50, 0.00],
  middle: [0.25, 0.50, 0.25],
  lower:  [0.00, 0.50, 0.50],
};

// 4人中3人が直近3試合で同じかチェック
function hasSimilarRecentMatch(fourPlayers: string[], player: Player): boolean {
  for (const recentMatch of player.recentMatches) {
    const overlap = fourPlayers.filter(id => recentMatch.includes(id));
    if (overlap.length >= 3) return true;
  }
  return false;
}

// 上位と下位が同時にいる場合、どちらか1人だけはNG
function hasIsolatedExtreme(members: Player[]): boolean {
  const upperCount = members.filter(m => m.group === 'upper').length;
  const lowerCount = members.filter(m => m.group === 'lower').length;
  
  if (upperCount > 0 && lowerCount > 0) {
    // 両方いる場合、どちらかが1人だけならNG
    if (upperCount === 1 || lowerCount === 1) {
      // ただし、もう一方が3人の場合のみNG（1:1, 1:2, 2:1, 2:2はOK）
      if (upperCount >= 3 || lowerCount >= 3) {
        return true;
      }
    }
  }
  return false;
}

// 配置実行
function assignCourts(
  players: Player[],
  usedPlayers: Set<string>
): Map<number, Player[]> {
  const assignments = new Map<number, Player[]>([
    [1, []], [2, []], [3, []]
  ]);
  
  // 各コートに配置
  for (let courtId = 1; courtId <= 3; courtId++) {
    const probs = COURT_PROBABILITIES_3;
    
    // このコートに配置可能なプレイヤーを集める
    const eligible = players.filter(p => {
      if (usedPlayers.has(p.id)) return false;
      return probs[p.group][courtId - 1] > 0;
    });
    
    // 回数少ない順にソート
    eligible.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
    
    // 4人選ぶ（制約を満たすように）
    const selected: Player[] = [];
    
    for (const player of eligible) {
      if (selected.length >= 4) break;
      
      // 仮に追加した場合の制約チェック
      const testMembers = [...selected, player];
      
      // 直近3試合で3人同じチェック
      if (selected.length >= 3) {
        if (hasSimilarRecentMatch(testMembers.map(m => m.id), player)) {
          continue;
        }
      }
      
      // 上位/下位の孤立チェック（4人目の時）
      if (testMembers.length === 4) {
        if (hasIsolatedExtreme(testMembers)) {
          continue;
        }
      }
      
      selected.push(player);
      usedPlayers.add(player.id);
    }
    
    // 制約で4人揃わなかった場合、制約を緩和して再試行
    if (selected.length < 4) {
      const remaining = players.filter(p => !usedPlayers.has(p.id));
      remaining.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
      
      for (const player of remaining) {
        if (selected.length >= 4) break;
        selected.push(player);
        usedPlayers.add(player.id);
      }
    }
    
    assignments.set(courtId, selected);
  }
  
  return assignments;
}

// シミュレーション実行
function simulate(playerCount: number, rounds: number) {
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: `p${i}`,
      name: `P${String(i + 1).padStart(2, '0')}`,
      rating: 100 + Math.floor(Math.random() * 100),
      group: 'middle',
      gamesPlayed: 0,
      recentMatches: [],
    });
  }
  
  groupPlayers3Court(players);
  
  const groups = {
    upper: players.filter(p => p.group === 'upper'),
    middle: players.filter(p => p.group === 'middle'),
    lower: players.filter(p => p.group === 'lower'),
  };
  
  console.log(`\n【グループ分け】`);
  console.log(`  上位G: ${groups.upper.length}人 - ${groups.upper.map(p => `${p.name}(${p.rating})`).join(', ')}`);
  console.log(`  中位G: ${groups.middle.length}人 - ${groups.middle.map(p => `${p.name}(${p.rating})`).join(', ')}`);
  console.log(`  下位G: ${groups.lower.length}人 - ${groups.lower.map(p => `${p.name}(${p.rating})`).join(', ')}`);
  
  let isolatedExtremeCount = 0;
  
  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();
    const assignments = assignCourts(players, usedPlayers);
    
    // 各コートの結果を記録
    for (const [courtId, members] of assignments) {
      if (members.length === 4) {
        // 孤立チェック（デバッグ用）
        if (hasIsolatedExtreme(members)) {
          isolatedExtremeCount++;
        }
        
        const memberIds = members.map(m => m.id);
        members.forEach(m => {
          m.gamesPlayed++;
          m.recentMatches.unshift(memberIds);
          if (m.recentMatches.length > 3) m.recentMatches.pop();
        });
      }
    }
  }
  
  // 結果表示
  console.log(`\n【${rounds}ラウンド（${rounds * 3}試合）後の結果】`);
  
  for (const [groupName, members] of Object.entries(groups)) {
    const games = members.map(m => m.gamesPlayed);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    const min = Math.min(...games);
    const max = Math.max(...games);
    
    console.log(`\n  [${groupName}グループ]`);
    members.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    members.forEach(m => console.log(`    ${m.name}: ${m.gamesPlayed}回`));
    console.log(`    → 平均: ${avg.toFixed(1)}回, 最小: ${min}, 最大: ${max}, 差: ${max - min}`);
  }
  
  const allGames = players.map(p => p.gamesPlayed);
  const totalAvg = allGames.reduce((a, b) => a + b, 0) / allGames.length;
  const totalMin = Math.min(...allGames);
  const totalMax = Math.max(...allGames);
  const expected = (rounds * 3 * 4) / playerCount;
  
  console.log(`\n  [全体]`);
  console.log(`    平均: ${totalAvg.toFixed(1)}回, 最小: ${totalMin}, 最大: ${totalMax}, 差: ${totalMax - totalMin}`);
  console.log(`    理論値: ${expected.toFixed(1)}回/人`);
  console.log(`    孤立発生: ${isolatedExtremeCount}回`);
}

console.log('='.repeat(60));
console.log('  3コート、21人、20ラウンド（60試合）');
console.log('  制約: 上位/下位が同時にいる場合、どちらか1人だけはNG');
console.log('='.repeat(60));

simulate(21, 20);

console.log('\n' + '='.repeat(60));
console.log('  3コート、18人、20ラウンド（60試合）');
console.log('='.repeat(60));

simulate(18, 20);

console.log('\n' + '='.repeat(60));
console.log('  3コート、15人、20ラウンド（60試合）');
console.log('='.repeat(60));

simulate(15, 20);
