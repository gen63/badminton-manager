/**
 * レーティングベースのグルーピング配置シミュレーション
 * 試合参加回数の偏りを確認
 */

type RatingGroup = 'upper' | 'middle' | 'lower';

interface Player {
  id: string;
  name: string;
  rating: number;
  gamesPlayed: number;
}

const DEFAULT_RATING = 1500;

// プレイヤーをレーティングでグループ分け
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
    players.forEach((p) => groups.get('middle')!.add(p.id));
    return groups;
  }

  const sortedByRating = [...players].sort((a, b) => b.rating - a.rating);

  sortedByRating.forEach((player, index) => {
    if (index < 4) {
      groups.get('upper')!.add(player.id);
    } else if (index >= sortedByRating.length - 4) {
      groups.get('lower')!.add(player.id);
    } else {
      groups.get('middle')!.add(player.id);
    }
  });

  return groups;
}

// コートに対して配置可能なグループを取得
function getAllowedGroupsForCourt(
  courtId: number,
  totalCourtCount: number
): RatingGroup[] {
  if (totalCourtCount === 1) return ['upper', 'middle', 'lower'];
  if (totalCourtCount === 2) {
    if (courtId === 1) return ['upper', 'middle'];
    if (courtId === 2) return ['middle', 'lower'];
  }
  if (totalCourtCount === 3) {
    if (courtId === 1) return ['upper', 'middle'];
    if (courtId === 2) return ['upper', 'middle', 'lower'];
    if (courtId === 3) return ['middle', 'lower'];
  }
  return ['upper', 'middle', 'lower'];
}

// 1回の配置をシミュレート
function assignOneCourt(
  players: Player[],
  courtId: number,
  totalCourtCount: number,
  ratingGroups: Map<RatingGroup, Set<string>>,
  usedPlayers: Set<string>
): string[] | null {
  const allowedGroups = getAllowedGroupsForCourt(courtId, totalCourtCount);
  
  // 配置可能なプレイヤー
  let eligible = players.filter((p) => {
    if (usedPlayers.has(p.id)) return false;
    return allowedGroups.some((g) => ratingGroups.get(g)!.has(p.id));
  });

  // グループ制限で足りない場合はフォールバック
  if (eligible.length < 4) {
    eligible = players.filter((p) => !usedPlayers.has(p.id));
  }

  if (eligible.length < 4) return null;

  // プレイ回数が少ない順でソート
  eligible.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

  return eligible.slice(0, 4).map((p) => p.id);
}

// シミュレーション実行
function simulate(
  playerCount: number,
  courtCount: number,
  rounds: number
) {
  // プレイヤー生成（レーティングは100-200の範囲でランダム）
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: `p${i}`,
      name: `Player${i + 1}`,
      rating: 100 + Math.floor(Math.random() * 100), // 100-199
      gamesPlayed: 0,
    });
  }

  // レーティング順にソートして表示
  const sortedPlayers = [...players].sort((a, b) => b.rating - a.rating);
  console.log('\n=== プレイヤー一覧（レーティング順） ===');
  sortedPlayers.forEach((p, i) => {
    let group = 'middle';
    if (i < 4) group = 'upper';
    else if (i >= sortedPlayers.length - 4) group = 'lower';
    console.log(`${p.name}: ${p.rating} (${group})`);
  });

  const ratingGroups = groupPlayersByRating(players, courtCount);
  
  console.log('\n=== グループ分け ===');
  console.log('上位G:', [...ratingGroups.get('upper')!].map(id => players.find(p => p.id === id)?.name).join(', '));
  console.log('中位G:', [...ratingGroups.get('middle')!].map(id => players.find(p => p.id === id)?.name).join(', '));
  console.log('下位G:', [...ratingGroups.get('lower')!].map(id => players.find(p => p.id === id)?.name).join(', '));

  // ラウンドごとにシミュレート
  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();

    for (let courtId = 1; courtId <= courtCount; courtId++) {
      const assigned = assignOneCourt(
        players,
        courtId,
        courtCount,
        ratingGroups,
        usedPlayers
      );

      if (assigned) {
        assigned.forEach((id) => {
          usedPlayers.add(id);
          const player = players.find((p) => p.id === id);
          if (player) player.gamesPlayed++;
        });
      }
    }
  }

  // 結果表示
  console.log(`\n=== ${rounds}ラウンド後の試合参加回数（${courtCount}コート運用） ===`);
  
  // グループごとに表示
  const showGroup = (groupName: string, group: Set<string>) => {
    const groupPlayers = players
      .filter((p) => group.has(p.id))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    
    const games = groupPlayers.map((p) => p.gamesPlayed);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    const min = Math.min(...games);
    const max = Math.max(...games);

    console.log(`\n【${groupName}】`);
    groupPlayers.forEach((p) => {
      console.log(`  ${p.name}: ${p.gamesPlayed}回`);
    });
    console.log(`  → 平均: ${avg.toFixed(1)}回, 最小: ${min}回, 最大: ${max}回, 差: ${max - min}回`);
  };

  showGroup('上位グループ', ratingGroups.get('upper')!);
  showGroup('中位グループ', ratingGroups.get('middle')!);
  showGroup('下位グループ', ratingGroups.get('lower')!);

  // 全体統計
  const allGames = players.map((p) => p.gamesPlayed);
  const totalAvg = allGames.reduce((a, b) => a + b, 0) / allGames.length;
  const totalMin = Math.min(...allGames);
  const totalMax = Math.max(...allGames);

  console.log('\n【全体】');
  console.log(`  平均: ${totalAvg.toFixed(1)}回, 最小: ${totalMin}回, 最大: ${totalMax}回, 差: ${totalMax - totalMin}回`);
}

// 実行
console.log('========================================');
console.log('  20人で3コート運用、10ラウンド');
console.log('========================================');
simulate(20, 3, 10);

console.log('\n\n========================================');
console.log('  20人で3コート運用、20ラウンド');
console.log('========================================');
simulate(20, 3, 20);

console.log('\n\n========================================');
console.log('  12人で2コート運用、10ラウンド');
console.log('========================================');
simulate(12, 2, 10);
