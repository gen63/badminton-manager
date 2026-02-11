/**
 * コート配置シミュレーション
 *
 * 目的: 「upper→C1, middle→C2, lower→C3 固定」方式の検証
 * 条件: 3コート、21人（各グループ7人）
 *
 * 検証項目:
 * 1. hasSimilarRecentMatch(直近2試合, 3人以上重複禁止) でデッドロックが起きるか
 * 2. グループ内7人で何ラウンド連続配置が可能か
 * 3. cross-group借用が必要になる頻度
 * 4. 全く同じ4人の連続を回避できるか
 */

// ---- Types ----
interface SimPlayer {
  id: string;
  name: string;
  rating: number;
  group: 'upper' | 'middle' | 'lower';
  gamesPlayed: number;
}

interface SimMatch {
  courtId: number;
  players: string[];  // 4人のID
  round: number;
}

// ---- hasSimilarRecentMatch (本番と同じロジック) ----
function hasSimilarRecentMatch(
  fourPlayerIds: string[],
  matchHistory: SimMatch[]
): boolean {
  for (const playerId of fourPlayerIds) {
    let found = 0;
    for (const match of matchHistory) {
      if (found >= 2) break;
      if (!match.players.includes(playerId)) continue;
      found++;
      const overlap = fourPlayerIds.filter(id => match.players.includes(id));
      if (overlap.length >= 3) return true;
    }
  }
  return false;
}

// ---- 組み合わせ列挙 (C(n,4)) ----
function* combinations4(arr: string[]): Generator<string[]> {
  const n = arr.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          yield [arr[i], arr[j], arr[k], arr[l]];
        }
      }
    }
  }
}

// ---- シミュレーション1: 固定グループ（cross-groupなし）----
function simulateFixedGroup(
  groupSize: number,
  rounds: number,
  recentMatchCount: number = 2,
  overlapThreshold: number = 3
): { deadlockRound: number | null; roundDetails: string[] } {
  const players = Array.from({ length: groupSize }, (_, i) => `P${i + 1}`);
  const matchHistory: SimMatch[] = [];
  const roundDetails: string[] = [];

  for (let round = 0; round < rounds; round++) {
    // 優先度: gamesPlayedが少ない人を優先（簡略化）
    const gamesCount = new Map<string, number>();
    for (const p of players) gamesCount.set(p, 0);
    for (const m of matchHistory) {
      for (const p of m.players) {
        gamesCount.set(p, (gamesCount.get(p) ?? 0) + 1);
      }
    }

    // 全候補ソート（試合数少ない順）
    const sorted = [...players].sort((a, b) =>
      (gamesCount.get(a) ?? 0) - (gamesCount.get(b) ?? 0)
    );

    // 有効な4人の組み合わせを探す
    let bestCombo: string[] | null = null;
    let bestScore = Infinity;

    for (const combo of combinations4(sorted)) {
      if (hasSimilarRecentMatchCustom(combo, matchHistory, recentMatchCount, overlapThreshold)) continue;
      const score = combo.reduce((s, p) => s + (gamesCount.get(p) ?? 0), 0);
      if (score < bestScore) {
        bestScore = score;
        bestCombo = combo;
      }
    }

    if (!bestCombo) {
      roundDetails.push(`Round ${round + 1}: DEADLOCK! No valid combo found.`);
      return { deadlockRound: round + 1, roundDetails };
    }

    matchHistory.unshift({ courtId: 1, players: bestCombo, round: round + 1 });
    roundDetails.push(`Round ${round + 1}: [${bestCombo.join(', ')}]`);
  }

  return { deadlockRound: null, roundDetails };
}

function hasSimilarRecentMatchCustom(
  fourPlayerIds: string[],
  matchHistory: SimMatch[],
  recentMatchCount: number,
  overlapThreshold: number
): boolean {
  for (const playerId of fourPlayerIds) {
    let found = 0;
    for (const match of matchHistory) {
      if (found >= recentMatchCount) break;
      if (!match.players.includes(playerId)) continue;
      found++;
      const overlap = fourPlayerIds.filter(id => match.players.includes(id));
      if (overlap.length >= overlapThreshold) return true;
    }
  }
  return false;
}

// ---- シミュレーション2: 3コート同時配置 ----
function simulate3Courts(
  totalPlayers: number,
  rounds: number,
  probTable: Record<string, number[]>,
  recentMatchCount: number = 2,
  overlapThreshold: number = 3
): {
  results: SimMatch[][];
  crossGroupCount: number;
  deadlockCount: number;
  playerStats: Map<string, { games: number; courts: Map<number, number> }>;
  sameGroupRepeatCount: number;
} {
  // グループ分け（均等）
  const groupSize = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;
  const lowerSize = groupSize;

  const players: SimPlayer[] = [];
  let id = 1;
  for (let i = 0; i < upperSize; i++) {
    players.push({ id: `U${i + 1}`, name: `Upper${i + 1}`, rating: 2000 - i * 50, group: 'upper', gamesPlayed: 0 });
  }
  for (let i = 0; i < middleSize; i++) {
    players.push({ id: `M${i + 1}`, name: `Middle${i + 1}`, rating: 1500 - i * 50, group: 'middle', gamesPlayed: 0 });
  }
  for (let i = 0; i < lowerSize; i++) {
    players.push({ id: `L${i + 1}`, name: `Lower${i + 1}`, rating: 1000 - i * 50, group: 'lower', gamesPlayed: 0 });
  }

  const matchHistory: SimMatch[] = [];
  const results: SimMatch[][] = [];
  let crossGroupCount = 0;
  let deadlockCount = 0;
  let sameGroupRepeatCount = 0;

  const playerStats = new Map<string, { games: number; courts: Map<number, number> }>();
  for (const p of players) {
    playerStats.set(p.id, { games: 0, courts: new Map() });
  }

  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();
    const roundMatches: SimMatch[] = [];

    // 3コート順次配置 (C1→C2→C3)
    for (let courtId = 1; courtId <= 3; courtId++) {
      const courtGroup = courtId === 1 ? 'upper' : courtId === 2 ? 'middle' : 'lower';

      // eligible: prob > 0 のプレイヤー（使用済み除く）
      const eligible = players.filter(p => {
        if (usedPlayers.has(p.id)) return false;
        const prob = probTable[p.group]?.[courtId - 1] ?? 0;
        return prob > 0;
      });

      // 優先度ソート（試合数少ない順、同数ならグループ適性順）
      eligible.sort((a, b) => {
        const gamesDiff = a.gamesPlayed - b.gamesPlayed;
        if (gamesDiff !== 0) return gamesDiff;
        // グループ適性（同じグループを優先）
        const probA = probTable[a.group]?.[courtId - 1] ?? 0;
        const probB = probTable[b.group]?.[courtId - 1] ?? 0;
        return probB - probA; // 高い確率を優先
      });

      // 組み合わせ探索
      let bestCombo: string[] | null = null;
      let bestScore = Infinity;

      for (const combo of combinations4(eligible.map(p => p.id))) {
        if (hasSimilarRecentMatchCustom(combo, matchHistory, recentMatchCount, overlapThreshold)) continue;

        // スコア: gamesPlayed合計 + cross-groupペナルティ
        let score = 0;
        for (const pid of combo) {
          const p = players.find(pl => pl.id === pid)!;
          score += p.gamesPlayed;
          // グループ不一致にペナルティ
          const prob = probTable[p.group]?.[courtId - 1] ?? 0;
          score += (1 - prob) * 2;
        }
        if (score < bestScore) {
          bestScore = score;
          bestCombo = combo;
        }
      }

      if (!bestCombo) {
        // フォールバック: 制約緩和
        deadlockCount++;
        const fallback = eligible.slice(0, 4).map(p => p.id);
        bestCombo = fallback;
      }

      // cross-groupチェック
      for (const pid of bestCombo) {
        const p = players.find(pl => pl.id === pid)!;
        if (p.group !== courtGroup) crossGroupCount++;
      }

      // 前ラウンドの同じコートと比較
      if (round > 0) {
        const prevMatch = results[round - 1]?.find(m => m.courtId === courtId);
        if (prevMatch) {
          const overlap = bestCombo.filter(id => prevMatch.players.includes(id));
          if (overlap.length === 4) sameGroupRepeatCount++;
        }
      }

      const match: SimMatch = { courtId, players: bestCombo, round: round + 1 };
      matchHistory.unshift(match);
      roundMatches.push(match);

      for (const pid of bestCombo) {
        usedPlayers.add(pid);
        const p = players.find(pl => pl.id === pid)!;
        p.gamesPlayed++;
        const stat = playerStats.get(pid)!;
        stat.games++;
        stat.courts.set(courtId, (stat.courts.get(courtId) ?? 0) + 1);
      }
    }

    results.push(roundMatches);
  }

  return { results, crossGroupCount, deadlockCount, playerStats, sameGroupRepeatCount };
}

// ---- メイン実行 ----
console.log('='.repeat(70));
console.log('コート配置シミュレーション');
console.log('='.repeat(70));

// ============================
// テスト1: 7人グループでのデッドロック検証
// ============================
console.log('\n### テスト1: 7人グループ内でのデッドロック検証');
console.log('条件: 7人から4人選出、直近2試合/3人以上重複禁止\n');

const test1 = simulateFixedGroup(7, 20, 2, 3);
if (test1.deadlockRound) {
  console.log(`❌ デッドロック発生: ラウンド${test1.deadlockRound}`);
} else {
  console.log(`✅ 20ラウンドデッドロックなし`);
}
for (const d of test1.roundDetails.slice(0, 10)) {
  console.log(`  ${d}`);
}
if (test1.roundDetails.length > 10) {
  console.log(`  ... (残り${test1.roundDetails.length - 10}ラウンド省略)`);
}

// ============================
// テスト1b: パラメータ違いの検証
// ============================
console.log('\n### テスト1b: 7人グループ - パラメータ比較');
const params = [
  { recent: 2, threshold: 3, label: '直近2試合/3人重複 (現行)' },
  { recent: 1, threshold: 3, label: '直近1試合/3人重複' },
  { recent: 2, threshold: 4, label: '直近2試合/4人重複' },
  { recent: 1, threshold: 4, label: '直近1試合/4人重複' },
];

for (const p of params) {
  const result = simulateFixedGroup(7, 30, p.recent, p.threshold);
  const status = result.deadlockRound
    ? `❌ デッドロック@R${result.deadlockRound}`
    : `✅ 30ラウンドOK`;
  console.log(`  ${p.label}: ${status}`);
}

// ============================
// テスト2: 現行の確率テーブルで3コート21人
// ============================
console.log('\n### テスト2: 現行確率テーブル (分散配置)');
const currentProb = {
  upper:  [0.00, 0.50, 0.50],
  middle: [0.25, 0.50, 0.25],
  lower:  [0.50, 0.00, 0.50],
};

const test2 = simulate3Courts(21, 20, currentProb);
console.log(`  cross-group配置: ${test2.crossGroupCount}回`);
console.log(`  デッドロック(フォールバック): ${test2.deadlockCount}回`);
console.log(`  完全同一メンバー連続: ${test2.sameGroupRepeatCount}回`);

// コート別配置統計
console.log('\n  コート別グループ配置率:');
const courtGroupStats: Record<string, Record<number, number>> = {
  upper: { 1: 0, 2: 0, 3: 0 },
  middle: { 1: 0, 2: 0, 3: 0 },
  lower: { 1: 0, 2: 0, 3: 0 },
};
for (const [pid, stat] of test2.playerStats) {
  const group = pid.startsWith('U') ? 'upper' : pid.startsWith('M') ? 'middle' : 'lower';
  for (const [courtId, count] of stat.courts) {
    courtGroupStats[group][courtId] += count;
  }
}
for (const group of ['upper', 'middle', 'lower']) {
  const total = Object.values(courtGroupStats[group]).reduce((a, b) => a + b, 0);
  const pcts = [1, 2, 3].map(c => `C${c}:${((courtGroupStats[group][c] / total) * 100).toFixed(0)}%`);
  console.log(`    ${group.padEnd(7)}: ${pcts.join(' ')}`);
}

// ============================
// テスト3: 新テーブル（固定配置）
// ============================
console.log('\n### テスト3: 新確率テーブル (固定配置)');
const newProb = {
  upper:  [0.90, 0.05, 0.05],
  middle: [0.05, 0.90, 0.05],
  lower:  [0.05, 0.05, 0.90],
};

const test3 = simulate3Courts(21, 20, newProb);
console.log(`  cross-group配置: ${test3.crossGroupCount}回`);
console.log(`  デッドロック(フォールバック): ${test3.deadlockCount}回`);
console.log(`  完全同一メンバー連続: ${test3.sameGroupRepeatCount}回`);

console.log('\n  コート別グループ配置率:');
const courtGroupStats3: Record<string, Record<number, number>> = {
  upper: { 1: 0, 2: 0, 3: 0 },
  middle: { 1: 0, 2: 0, 3: 0 },
  lower: { 1: 0, 2: 0, 3: 0 },
};
for (const [pid, stat] of test3.playerStats) {
  const group = pid.startsWith('U') ? 'upper' : pid.startsWith('M') ? 'middle' : 'lower';
  for (const [courtId, count] of stat.courts) {
    courtGroupStats3[group][courtId] += count;
  }
}
for (const group of ['upper', 'middle', 'lower']) {
  const total = Object.values(courtGroupStats3[group]).reduce((a, b) => a + b, 0);
  const pcts = [1, 2, 3].map(c => `C${c}:${((courtGroupStats3[group][c] / total) * 100).toFixed(0)}%`);
  console.log(`    ${group.padEnd(7)}: ${pcts.join(' ')}`);
}

// ============================
// テスト4: 完全固定テーブル（prob=0以外なし）
// ============================
console.log('\n### テスト4: 完全固定テーブル (prob=0使用)');
const fixedProb = {
  upper:  [1.00, 0.00, 0.00],
  middle: [0.00, 1.00, 0.00],
  lower:  [0.00, 0.00, 1.00],
};

const test4 = simulate3Courts(21, 20, fixedProb);
console.log(`  cross-group配置: ${test4.crossGroupCount}回`);
console.log(`  デッドロック(フォールバック): ${test4.deadlockCount}回`);
console.log(`  完全同一メンバー連続: ${test4.sameGroupRepeatCount}回`);

console.log('\n  コート別グループ配置率:');
const courtGroupStats4: Record<string, Record<number, number>> = {
  upper: { 1: 0, 2: 0, 3: 0 },
  middle: { 1: 0, 2: 0, 3: 0 },
  lower: { 1: 0, 2: 0, 3: 0 },
};
for (const [pid, stat] of test4.playerStats) {
  const group = pid.startsWith('U') ? 'upper' : pid.startsWith('M') ? 'middle' : 'lower';
  for (const [courtId, count] of stat.courts) {
    courtGroupStats4[group][courtId] += count;
  }
}
for (const group of ['upper', 'middle', 'lower']) {
  const total = Object.values(courtGroupStats4[group]).reduce((a, b) => a + b, 0) || 1;
  const pcts = [1, 2, 3].map(c => `C${c}:${((courtGroupStats4[group][c] / total) * 100).toFixed(0)}%`);
  console.log(`    ${group.padEnd(7)}: ${pcts.join(' ')}`);
}

// ============================
// テスト5: 完全固定 + 制約緩和パラメータ
// ============================
console.log('\n### テスト5: 完全固定 + 直近1試合/3人重複禁止');
const test5 = simulate3Courts(21, 20, fixedProb, 1, 3);
console.log(`  cross-group配置: ${test5.crossGroupCount}回`);
console.log(`  デッドロック(フォールバック): ${test5.deadlockCount}回`);
console.log(`  完全同一メンバー連続: ${test5.sameGroupRepeatCount}回`);

// ============================
// テスト6: ラウンド詳細表示（固定テーブル、1コート分）
// ============================
console.log('\n### テスト6: 固定配置のラウンド詳細（C1のみ、直近2試合/3人重複）');
console.log('  → 7人(upper)から4人を連続選出:\n');
for (let r = 0; r < Math.min(10, test4.results.length); r++) {
  const c1match = test4.results[r].find(m => m.courtId === 1);
  if (c1match) {
    console.log(`  R${(r + 1).toString().padStart(2)}: [${c1match.players.join(', ')}]`);
  }
}

// ============================
// テスト7: 統計的検証（100回試行の平均）
// ============================
console.log('\n### テスト7: 統計的検証（100回試行）');
const configs = [
  { name: '現行(分散)',        prob: currentProb, recent: 2, threshold: 3 },
  { name: '固定(prob>0)',     prob: newProb,     recent: 2, threshold: 3 },
  { name: '完全固定(prob=0)', prob: fixedProb,   recent: 2, threshold: 3 },
  { name: '完全固定+緩和',   prob: fixedProb,   recent: 1, threshold: 3 },
];

for (const cfg of configs) {
  let totalCrossGroup = 0;
  let totalDeadlock = 0;
  let totalSameRepeat = 0;

  for (let trial = 0; trial < 100; trial++) {
    const result = simulate3Courts(21, 20, cfg.prob, cfg.recent, cfg.threshold);
    totalCrossGroup += result.crossGroupCount;
    totalDeadlock += result.deadlockCount;
    totalSameRepeat += result.sameGroupRepeatCount;
  }

  console.log(`  ${cfg.name.padEnd(20)}: crossGroup=${(totalCrossGroup / 100).toFixed(1)} deadlock=${(totalDeadlock / 100).toFixed(1)} sameRepeat=${(totalSameRepeat / 100).toFixed(1)}`);
}

// ============================
// テスト8: プレイヤー間の公平性（試合数のばらつき）
// ============================
console.log('\n### テスト8: 公平性検証（20ラウンド後の試合数分布）');
for (const cfg of [
  { name: '現行(分散)',        prob: currentProb, recent: 2, threshold: 3 },
  { name: '完全固定(prob=0)', prob: fixedProb,   recent: 2, threshold: 3 },
]) {
  const result = simulate3Courts(21, 20, cfg.prob, cfg.recent, cfg.threshold);
  const games = Array.from(result.playerStats.values()).map(s => s.games);
  const min = Math.min(...games);
  const max = Math.max(...games);
  const avg = games.reduce((a, b) => a + b, 0) / games.length;
  const stddev = Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
  console.log(`  ${cfg.name.padEnd(20)}: min=${min} max=${max} avg=${avg.toFixed(1)} stddev=${stddev.toFixed(2)}`);
}

// ============================
// テスト9: 性別パターン別シミュレーション
// ============================
console.log('\n### テスト9: 性別パターン別（固定配置 prob=0.90）');
console.log('  各グループ7人、20ラウンド\n');

interface GenderSimResult {
  label: string;
  mixRate: number;       // MIX (2M+2F) になった割合
  sameGenderRate: number; // 同性 (4M/4F) になった割合
  unbalancedRate: number; // 3-1 になった割合
  crossGroupCount: number;
  deadlockCount: number;
}

function simulate3CourtsWithGender(
  totalPlayers: number,
  rounds: number,
  probTable: Record<string, number[]>,
  femalePattern: number[], // 各グループの女性数 [upper, middle, lower]
): GenderSimResult {
  const groupSize = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;
  const sizes = [groupSize, groupSize + remainder, groupSize];
  const groupNames = ['upper', 'middle', 'lower'] as const;

  const players: (SimPlayer & { gender: 'M' | 'F' })[] = [];

  for (let g = 0; g < 3; g++) {
    const prefix = g === 0 ? 'U' : g === 1 ? 'M' : 'L';
    const femaleCount = femalePattern[g];
    for (let i = 0; i < sizes[g]; i++) {
      players.push({
        id: `${prefix}${i + 1}`,
        name: `${groupNames[g]}${i + 1}`,
        rating: (2000 - g * 500) - i * 50,
        group: groupNames[g],
        gamesPlayed: 0,
        gender: i < femaleCount ? 'F' : 'M',
      });
    }
  }

  const matchHistory: SimMatch[] = [];
  let crossGroupCount = 0;
  let deadlockCount = 0;
  let mixCount = 0;
  let sameGenderCount = 0;
  let unbalancedCount = 0;
  let totalMatches = 0;

  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();

    for (let courtId = 1; courtId <= 3; courtId++) {
      const courtGroup = groupNames[courtId - 1];

      const eligible = players.filter(p => {
        if (usedPlayers.has(p.id)) return false;
        const prob = probTable[p.group]?.[courtId - 1] ?? 0;
        return prob > 0;
      });

      eligible.sort((a, b) => {
        const gamesDiff = a.gamesPlayed - b.gamesPlayed;
        if (gamesDiff !== 0) return gamesDiff;
        const probA = probTable[a.group]?.[courtId - 1] ?? 0;
        const probB = probTable[b.group]?.[courtId - 1] ?? 0;
        return probB - probA;
      });

      let bestCombo: string[] | null = null;
      let bestScore = Infinity;

      for (const combo of combinations4(eligible.map(p => p.id))) {
        if (hasSimilarRecentMatch(combo, matchHistory)) continue;

        let score = 0;
        const comboPlayers = combo.map(id => players.find(p => p.id === id)!);
        for (const p of comboPlayers) {
          score += p.gamesPlayed;
          const prob = probTable[p.group]?.[courtId - 1] ?? 0;
          score += (1 - prob) * 2;
        }

        // 性別ペナルティ
        const females = comboPlayers.filter(p => p.gender === 'F').length;
        if (females === 1 || females === 3) {
          score += 1.0; // 3-1ペナルティ
        }

        if (score < bestScore) {
          bestScore = score;
          bestCombo = combo;
        }
      }

      if (!bestCombo) {
        deadlockCount++;
        bestCombo = eligible.slice(0, 4).map(p => p.id);
      }

      // 統計
      const selectedPlayers = bestCombo.map(id => players.find(p => p.id === id)!);
      const femaleCount = selectedPlayers.filter(p => p.gender === 'F').length;
      totalMatches++;
      if (femaleCount === 0 || femaleCount === 4) sameGenderCount++;
      else if (femaleCount === 2) mixCount++;
      else unbalancedCount++;

      for (const pid of bestCombo) {
        const p = players.find(pl => pl.id === pid)!;
        if (p.group !== courtGroup) crossGroupCount++;
        usedPlayers.add(pid);
        p.gamesPlayed++;
      }

      matchHistory.unshift({ courtId, players: bestCombo, round: round + 1 });
    }
  }

  return {
    label: `F=${femalePattern.join('+')}`,
    mixRate: mixCount / totalMatches,
    sameGenderRate: sameGenderCount / totalMatches,
    unbalancedRate: unbalancedCount / totalMatches,
    crossGroupCount,
    deadlockCount,
  };
}

// 性別パターン
const genderPatterns = [
  // [upper内F数, middle内F数, lower内F数]
  { label: '女性5割(10/21)', pattern: [3, 4, 3] },
  { label: '女性5割偏り(5,4,1)', pattern: [5, 4, 1] },
  { label: '女性3割(6/21)', pattern: [2, 2, 2] },
  { label: '女性3割偏り(3,2,1)', pattern: [3, 2, 1] },
  { label: '女性2割(4/21)', pattern: [1, 2, 1] },
  { label: '女性2割偏り(0,2,2)', pattern: [0, 2, 2] },
  { label: '女性1割(2/21)', pattern: [0, 1, 1] },
];

console.log('  パターン                  MIX率  同性率  3-1率  cross deadlock');
console.log('  ' + '-'.repeat(68));

for (const gp of genderPatterns) {
  const result = simulate3CourtsWithGender(21, 20, newProb, gp.pattern);
  console.log(
    `  ${gp.label.padEnd(25)} ` +
    `${(result.mixRate * 100).toFixed(0).padStart(4)}% ` +
    `${(result.sameGenderRate * 100).toFixed(0).padStart(5)}% ` +
    `${(result.unbalancedRate * 100).toFixed(0).padStart(5)}% ` +
    `${String(result.crossGroupCount).padStart(5)} ` +
    `${String(result.deadlockCount).padStart(8)}`
  );
}

// ============================
// テスト10: 性別パターン × 確率テーブル比較
// ============================
console.log('\n### テスト10: 女性3割(2,2,2) - 確率テーブル比較');
const probTables = [
  { name: '現行(分散)',    prob: currentProb },
  { name: '固定(prob>0)',  prob: newProb },
  { name: '完全固定',     prob: fixedProb },
];

for (const pt of probTables) {
  const result = simulate3CourtsWithGender(21, 20, pt.prob, [2, 2, 2]);
  console.log(
    `  ${pt.name.padEnd(18)} ` +
    `MIX:${(result.mixRate * 100).toFixed(0).padStart(3)}% ` +
    `同性:${(result.sameGenderRate * 100).toFixed(0).padStart(3)}% ` +
    `3-1:${(result.unbalancedRate * 100).toFixed(0).padStart(3)}% ` +
    `cross:${result.crossGroupCount} ` +
    `deadlock:${result.deadlockCount}`
  );
}

// ============================
// テスト11: 大量統計（女性3割、100回試行）
// ============================
console.log('\n### テスト11: 女性3割(2,2,2) 100回試行平均');
for (const pt of probTables) {
  let totalMix = 0, totalSame = 0, totalUnbal = 0, totalCross = 0, totalDead = 0;
  const trials = 100;
  for (let t = 0; t < trials; t++) {
    const r = simulate3CourtsWithGender(21, 20, pt.prob, [2, 2, 2]);
    totalMix += r.mixRate;
    totalSame += r.sameGenderRate;
    totalUnbal += r.unbalancedRate;
    totalCross += r.crossGroupCount;
    totalDead += r.deadlockCount;
  }
  console.log(
    `  ${pt.name.padEnd(18)} ` +
    `MIX:${((totalMix / trials) * 100).toFixed(1).padStart(5)}% ` +
    `同性:${((totalSame / trials) * 100).toFixed(1).padStart(5)}% ` +
    `3-1:${((totalUnbal / trials) * 100).toFixed(1).padStart(5)}% ` +
    `cross:${(totalCross / trials).toFixed(1)} ` +
    `deadlock:${(totalDead / trials).toFixed(1)}`
  );
}

// ============================
// テスト12a: 完全固定 + 隣接グループ借用方式
// ============================
console.log('\n### テスト12a: 完全固定 + 隣接グループ段階的借用（14-21人、100回平均）');
console.log('  ロジック: home groupでデッドロック → 隣接グループの境界メンバーを1人ずつ追加\n');

function simulate3CourtsWithBorrowing(
  totalPlayers: number,
  rounds: number,
): {
  crossGroupCount: number;
  deadlockCount: number;
  sameGroupRepeatCount: number;
  playerStats: Map<string, { games: number; courts: Map<number, number> }>;
  borrowDetails: { courtId: number; borrowed: number; round: number }[];
} {
  const groupSize = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;
  const lowerSize = groupSize;

  const players: SimPlayer[] = [];
  for (let i = 0; i < upperSize; i++) {
    players.push({ id: `U${i + 1}`, name: `Upper${i + 1}`, rating: 2000 - i * 50, group: 'upper', gamesPlayed: 0 });
  }
  for (let i = 0; i < middleSize; i++) {
    players.push({ id: `M${i + 1}`, name: `Middle${i + 1}`, rating: 1500 - i * 50, group: 'middle', gamesPlayed: 0 });
  }
  for (let i = 0; i < lowerSize; i++) {
    players.push({ id: `L${i + 1}`, name: `Lower${i + 1}`, rating: 1000 - i * 50, group: 'lower', gamesPlayed: 0 });
  }

  const matchHistory: SimMatch[] = [];
  let crossGroupCount = 0;
  let deadlockCount = 0;
  let sameGroupRepeatCount = 0;
  const borrowDetails: { courtId: number; borrowed: number; round: number }[] = [];

  const playerStats = new Map<string, { games: number; courts: Map<number, number> }>();
  for (const p of players) {
    playerStats.set(p.id, { games: 0, courts: new Map() });
  }

  // 序列順（rating降順、全プレイヤー）
  const globalOrder = [...players].sort((a, b) => b.rating - a.rating).map(p => p.id);

  const results: SimMatch[][] = [];

  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();
    const roundMatches: SimMatch[] = [];

    for (let courtId = 1; courtId <= 3; courtId++) {
      const courtGroup = courtId === 1 ? 'upper' : courtId === 2 ? 'middle' : 'lower';

      // Step 1: homeグループのみ
      const homeGroup = players.filter(p =>
        p.group === courtGroup && !usedPlayers.has(p.id)
      );
      homeGroup.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

      // 隣接グループの候補（序列的に近い順）
      const adjacentCandidates: SimPlayer[] = [];
      if (courtGroup === 'upper') {
        // middle の上位（序列順で upper に近い）
        const middlePlayers = players
          .filter(p => p.group === 'middle' && !usedPlayers.has(p.id))
          .sort((a, b) => b.rating - a.rating); // rating高い順（upperに近い）
        adjacentCandidates.push(...middlePlayers);
      } else if (courtGroup === 'lower') {
        // middle の下位（序列順で lower に近い）
        const middlePlayers = players
          .filter(p => p.group === 'middle' && !usedPlayers.has(p.id))
          .sort((a, b) => a.rating - b.rating); // rating低い順（lowerに近い）
        adjacentCandidates.push(...middlePlayers);
      } else {
        // middle: upper の下位 + lower の上位
        const upperBottom = players
          .filter(p => p.group === 'upper' && !usedPlayers.has(p.id))
          .sort((a, b) => a.rating - b.rating); // rating低い順（middleに近い）
        const lowerTop = players
          .filter(p => p.group === 'lower' && !usedPlayers.has(p.id))
          .sort((a, b) => b.rating - a.rating); // rating高い順（middleに近い）
        // 交互に追加
        const maxLen = Math.max(upperBottom.length, lowerTop.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < upperBottom.length) adjacentCandidates.push(upperBottom[i]);
          if (i < lowerTop.length) adjacentCandidates.push(lowerTop[i]);
        }
      }

      // 段階的に候補を拡大
      let bestCombo: string[] | null = null;
      let borrowedCount = 0;

      for (let expand = 0; expand <= adjacentCandidates.length; expand++) {
        const candidates = [...homeGroup];
        if (expand > 0) {
          candidates.push(...adjacentCandidates.slice(0, expand));
        }
        candidates.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

        if (candidates.length < 4) continue;

        // 組み合わせ探索
        let localBest: string[] | null = null;
        let localBestScore = Infinity;

        for (const combo of combinations4(candidates.map(p => p.id))) {
          if (hasSimilarRecentMatch(combo, matchHistory)) continue;

          let score = 0;
          for (const pid of combo) {
            const p = players.find(pl => pl.id === pid)!;
            score += p.gamesPlayed;
            // 非homeグループにペナルティ
            if (p.group !== courtGroup) score += 3;
          }
          if (score < localBestScore) {
            localBestScore = score;
            localBest = combo;
          }
        }

        if (localBest) {
          bestCombo = localBest;
          borrowedCount = expand;
          break;
        }
      }

      if (!bestCombo) {
        deadlockCount++;
        // 最終フォールバック
        const allAvailable = players
          .filter(p => !usedPlayers.has(p.id))
          .sort((a, b) => a.gamesPlayed - b.gamesPlayed);
        bestCombo = allAvailable.slice(0, 4).map(p => p.id);
      }

      if (borrowedCount > 0) {
        borrowDetails.push({ courtId, borrowed: borrowedCount, round: round + 1 });
      }

      // 統計
      for (const pid of bestCombo) {
        const p = players.find(pl => pl.id === pid)!;
        if (p.group !== courtGroup) crossGroupCount++;
        usedPlayers.add(pid);
        p.gamesPlayed++;
        const stat = playerStats.get(pid)!;
        stat.games++;
        stat.courts.set(courtId, (stat.courts.get(courtId) ?? 0) + 1);
      }

      // 前ラウンド比較
      if (round > 0 && results[round - 1]) {
        const prevMatch = results[round - 1].find(m => m.courtId === courtId);
        if (prevMatch) {
          const overlap = bestCombo.filter(id => prevMatch.players.includes(id));
          if (overlap.length === 4) sameGroupRepeatCount++;
        }
      }

      matchHistory.unshift({ courtId, players: bestCombo, round: round + 1 });
      roundMatches.push({ courtId, players: bestCombo, round: round + 1 });
    }
    results.push(roundMatches);
  }

  return { crossGroupCount, deadlockCount, sameGroupRepeatCount, playerStats, borrowDetails };
}

console.log('  人数  グループ   crossGroup deadlock sameRepeat  借用発生回数  公平性(stddev)');
console.log('  ' + '-'.repeat(80));

for (let n = 14; n <= 21; n++) {
  const groupSize = Math.floor(n / 3);
  const remainder = n % 3;
  const groupLabel = `${groupSize}/${groupSize + remainder}/${groupSize}`;

  let totalCross = 0, totalDead = 0, totalRepeat = 0, totalBorrow = 0, totalStddev = 0;
  const trials = 100;

  for (let t = 0; t < trials; t++) {
    const result = simulate3CourtsWithBorrowing(n, 20);
    totalCross += result.crossGroupCount;
    totalDead += result.deadlockCount;
    totalRepeat += result.sameGroupRepeatCount;
    totalBorrow += result.borrowDetails.length;

    const games = Array.from(result.playerStats.values()).map(s => s.games);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    const stddev = Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
    totalStddev += stddev;
  }

  console.log(
    `  ${String(n).padStart(2)}人  ${groupLabel.padEnd(9)} ` +
    `${(totalCross / trials).toFixed(1).padStart(10)} ` +
    `${(totalDead / trials).toFixed(1).padStart(8)} ` +
    `${(totalRepeat / trials).toFixed(1).padStart(10)} ` +
    `${(totalBorrow / trials).toFixed(1).padStart(12)} ` +
    `${(totalStddev / trials).toFixed(2).padStart(14)}`
  );
}

// 借用の詳細（21人1回分）
console.log('\n  --- 21人、借用方式 1回分の詳細 ---');
const detail21 = simulate3CourtsWithBorrowing(21, 20);
if (detail21.borrowDetails.length === 0) {
  console.log('  借用なし（全ラウンドhomeグループ内で解決）');
} else {
  for (const b of detail21.borrowDetails) {
    const courtName = b.courtId === 1 ? 'C1(upper)' : b.courtId === 2 ? 'C2(middle)' : 'C3(lower)';
    console.log(`  R${String(b.round).padStart(2)} ${courtName}: 隣接${b.borrowed}人追加で解決`);
  }
}

// 固定(0.90)方式との比較表
console.log('\n  --- 方式比較（21人、100回平均）---');
{
  // 固定(0.90)
  let c1 = 0, d1 = 0, s1 = 0, sd1 = 0;
  for (let t = 0; t < 100; t++) {
    const r = simulate3Courts(21, 20, newProb);
    c1 += r.crossGroupCount; d1 += r.deadlockCount; s1 += r.sameGroupRepeatCount;
    const games = Array.from(r.playerStats.values()).map(s => s.games);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    sd1 += Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
  }
  // 借用方式
  let c2 = 0, d2 = 0, s2 = 0, sd2 = 0, borrow2 = 0;
  for (let t = 0; t < 100; t++) {
    const r = simulate3CourtsWithBorrowing(21, 20);
    c2 += r.crossGroupCount; d2 += r.deadlockCount; s2 += r.sameGroupRepeatCount;
    borrow2 += r.borrowDetails.length;
    const games = Array.from(r.playerStats.values()).map(s => s.games);
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    sd2 += Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
  }
  console.log(`  固定(0.90)     : cross=${(c1/100).toFixed(1)} deadlock=${(d1/100).toFixed(1)} repeat=${(s1/100).toFixed(1)} stddev=${(sd1/100).toFixed(2)}`);
  console.log(`  借用方式        : cross=${(c2/100).toFixed(1)} deadlock=${(d2/100).toFixed(1)} repeat=${(s2/100).toFixed(1)} borrow=${(borrow2/100).toFixed(1)} stddev=${(sd2/100).toFixed(2)}`);
}

// ============================
// テスト12: 14-21人 × 確率テーブル比較（100回試行平均）
// ============================
console.log('\n### テスト12: 14-21人 × 確率テーブル比較（3コート、20ラウンド、100回平均）');
console.log('  ※グループサイズ = [upper, middle, lower]\n');

const probConfigs = [
  { name: '現行(分散)',   prob: currentProb },
  { name: '固定(0.90)',  prob: newProb },
  { name: '完全固定',    prob: fixedProb },
];

console.log('  人数  グループ   方式              crossGroup deadlock sameRepeat  公平性(stddev)');
console.log('  ' + '-'.repeat(85));

for (let n = 14; n <= 21; n++) {
  const groupSize = Math.floor(n / 3);
  const remainder = n % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;
  const lowerSize = groupSize;
  const groupLabel = `${upperSize}/${middleSize}/${lowerSize}`;

  for (const cfg of probConfigs) {
    let totalCross = 0, totalDead = 0, totalRepeat = 0;
    let totalStddev = 0;

    const trials = 100;
    for (let t = 0; t < trials; t++) {
      const result = simulate3Courts(n, 20, cfg.prob);
      totalCross += result.crossGroupCount;
      totalDead += result.deadlockCount;
      totalRepeat += result.sameGroupRepeatCount;

      // 公平性
      const games = Array.from(result.playerStats.values()).map(s => s.games);
      const avg = games.reduce((a, b) => a + b, 0) / games.length;
      const stddev = Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
      totalStddev += stddev;
    }

    console.log(
      `  ${String(n).padStart(2)}人  ${groupLabel.padEnd(9)} ` +
      `${cfg.name.padEnd(16)} ` +
      `${(totalCross / trials).toFixed(1).padStart(10)} ` +
      `${(totalDead / trials).toFixed(1).padStart(8)} ` +
      `${(totalRepeat / trials).toFixed(1).padStart(10)} ` +
      `${(totalStddev / trials).toFixed(2).padStart(14)}`
    );
  }
  console.log('');
}

// ============================
// テスト13: 14-21人 単独グループのデッドロック検証
// ============================
console.log('\n### テスト13: 各グループサイズでのデッドロック検証（30ラウンド）');
console.log('  ※ 3コートの最小グループサイズ（upper/lower）に該当\n');

for (let size = 4; size <= 8; size++) {
  const results = [];
  for (const p of params) {
    const result = simulateFixedGroup(size, 30, p.recent, p.threshold);
    results.push({
      label: p.label,
      deadlock: result.deadlockRound,
    });
  }
  console.log(`  ${size}人グループ:`);
  for (const r of results) {
    const status = r.deadlock ? `デッドロック@R${r.deadlock}` : '30ラウンドOK';
    console.log(`    ${r.label.padEnd(25)}: ${status}`);
  }
  console.log('');
}

// ============================
// テスト14: 14-21人 × 性別パターン（固定0.90、100回平均）
// ============================
console.log('\n### テスト14: 14-21人 × 女性3割（固定0.90、20ラウンド、100回平均）');
console.log('  ※ 女性を各グループに均等に近く配分\n');

console.log('  人数  グループ   F配分     MIX率  同性率  3-1率  crossGroup  deadlock');
console.log('  ' + '-'.repeat(75));

for (let n = 14; n <= 21; n++) {
  const groupSize = Math.floor(n / 3);
  const remainder = n % 3;
  const sizes = [groupSize, groupSize + remainder, groupSize];
  const groupLabel = `${sizes[0]}/${sizes[1]}/${sizes[2]}`;

  // 女性3割（均等分配）
  const totalFemale = Math.round(n * 0.3);
  const fPerGroup = Math.floor(totalFemale / 3);
  const fRemainder = totalFemale % 3;
  const femalePattern = [fPerGroup, fPerGroup + fRemainder, fPerGroup];
  const fLabel = femalePattern.join('/');

  let totalMix = 0, totalSame = 0, totalUnbal = 0, totalCross = 0, totalDead = 0;
  const trials = 100;
  for (let t = 0; t < trials; t++) {
    const r = simulate3CourtsWithGender(n, 20, newProb, femalePattern);
    totalMix += r.mixRate;
    totalSame += r.sameGenderRate;
    totalUnbal += r.unbalancedRate;
    totalCross += r.crossGroupCount;
    totalDead += r.deadlockCount;
  }

  console.log(
    `  ${String(n).padStart(2)}人  ${groupLabel.padEnd(9)} ` +
    `F:${fLabel.padEnd(7)} ` +
    `${((totalMix / trials) * 100).toFixed(0).padStart(4)}% ` +
    `${((totalSame / trials) * 100).toFixed(0).padStart(5)}% ` +
    `${((totalUnbal / trials) * 100).toFixed(0).padStart(5)}% ` +
    `${(totalCross / trials).toFixed(1).padStart(10)} ` +
    `${(totalDead / trials).toFixed(1).padStart(8)}`
  );
}

// ============================
// テスト15: 借用方式 + 敗北時降下（序列変動あり）
// ============================
console.log('\n### テスト15: 借用方式 + 敗北時降下（14-21人、100回平均、20ラウンド）');
console.log('  勝利: 1つ上、2連勝でgroupSizeジャンプ');
console.log('  敗北: ceil(groupSize/2)下がる（≒2連敗で境界越え）');
console.log('  試合結果: 50%ランダム勝敗\n');

function simulate3CourtsWithStreaks(
  totalPlayers: number,
  rounds: number,
  dropMode: 'none' | 'ceil2' | 'ceil3',
): {
  crossGroupCount: number;
  deadlockCount: number;
  borrowCount: number;
  playerStats: Map<string, { games: number; courts: Map<number, number> }>;
  groupChanges: number; // グループ境界を越えた回数
  uniqueOpponents: Map<string, Set<string>>; // 各プレイヤーが対戦した相手の集合
} {
  // 序列（全プレイヤーのID配列、rating降順）
  const order: string[] = [];
  const streaks = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();

  const groupSize = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;
  const lowerSize = groupSize;

  // 初期化
  for (let i = 0; i < upperSize; i++) {
    const id = `P${i + 1}`;
    order.push(id);
    streaks.set(id, 0);
    gamesPlayed.set(id, 0);
  }
  for (let i = 0; i < middleSize; i++) {
    const id = `P${upperSize + i + 1}`;
    order.push(id);
    streaks.set(id, 0);
    gamesPlayed.set(id, 0);
  }
  for (let i = 0; i < lowerSize; i++) {
    const id = `P${upperSize + middleSize + i + 1}`;
    order.push(id);
    streaks.set(id, 0);
    gamesPlayed.set(id, 0);
  }

  const matchHistory: SimMatch[] = [];
  let crossGroupCount = 0;
  let deadlockCount = 0;
  let borrowCount = 0;
  let groupChanges = 0;

  const playerStats = new Map<string, { games: number; courts: Map<number, number> }>();
  const uniqueOpponents = new Map<string, Set<string>>();
  for (const id of order) {
    playerStats.set(id, { games: 0, courts: new Map() });
    uniqueOpponents.set(id, new Set());
  }

  // グループ判定関数
  function getGroup(playerId: string): 'upper' | 'middle' | 'lower' {
    const idx = order.indexOf(playerId);
    if (idx < upperSize) return 'upper';
    if (idx < upperSize + middleSize) return 'middle';
    return 'lower';
  }

  const results: SimMatch[][] = [];

  for (let round = 0; round < rounds; round++) {
    // 現在の序列からグループを計算
    const prevGroups = new Map<string, string>();
    for (const id of order) {
      prevGroups.set(id, getGroup(id));
    }

    const usedPlayers = new Set<string>();
    const roundMatches: SimMatch[] = [];

    for (let courtId = 1; courtId <= 3; courtId++) {
      const courtGroup = courtId === 1 ? 'upper' : courtId === 2 ? 'middle' : 'lower';

      // homeグループのプレイヤー
      const homeGroup = order
        .filter(id => getGroup(id) === courtGroup && !usedPlayers.has(id))
        .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }));
      homeGroup.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

      // 隣接グループ候補
      const adjacentCandidates: { id: string; gamesPlayed: number }[] = [];
      if (courtGroup === 'upper') {
        const mid = order
          .filter(id => getGroup(id) === 'middle' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }));
        adjacentCandidates.push(...mid);
      } else if (courtGroup === 'lower') {
        const mid = order
          .filter(id => getGroup(id) === 'middle' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }))
          .reverse();
        adjacentCandidates.push(...mid);
      } else {
        const up = order
          .filter(id => getGroup(id) === 'upper' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }))
          .reverse();
        const lo = order
          .filter(id => getGroup(id) === 'lower' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }));
        const maxLen = Math.max(up.length, lo.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < up.length) adjacentCandidates.push(up[i]);
          if (i < lo.length) adjacentCandidates.push(lo[i]);
        }
      }

      // 段階的借用
      let bestCombo: string[] | null = null;
      let borrowed = 0;

      for (let expand = 0; expand <= adjacentCandidates.length; expand++) {
        const candidates = [...homeGroup];
        if (expand > 0) {
          candidates.push(...adjacentCandidates.slice(0, expand));
        }
        candidates.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
        if (candidates.length < 4) continue;

        let localBest: string[] | null = null;
        let localBestScore = Infinity;

        for (const combo of combinations4(candidates.map(c => c.id))) {
          if (hasSimilarRecentMatch(combo, matchHistory)) continue;
          let score = 0;
          for (const pid of combo) {
            score += gamesPlayed.get(pid) ?? 0;
            if (getGroup(pid) !== courtGroup) score += 3;
          }
          if (score < localBestScore) {
            localBestScore = score;
            localBest = combo;
          }
        }

        if (localBest) {
          bestCombo = localBest;
          borrowed = expand;
          break;
        }
      }

      if (!bestCombo) {
        deadlockCount++;
        const allAvailable = order
          .filter(id => !usedPlayers.has(id))
          .sort((a, b) => (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0));
        bestCombo = allAvailable.slice(0, 4);
      }

      if (borrowed > 0) borrowCount++;

      for (const pid of bestCombo) {
        if (getGroup(pid) !== courtGroup) crossGroupCount++;
        usedPlayers.add(pid);
        gamesPlayed.set(pid, (gamesPlayed.get(pid) ?? 0) + 1);
        const stat = playerStats.get(pid)!;
        stat.games++;
        stat.courts.set(courtId, (stat.courts.get(courtId) ?? 0) + 1);
        // 対戦相手を記録
        for (const opp of bestCombo) {
          if (opp !== pid) uniqueOpponents.get(pid)!.add(opp);
        }
      }

      matchHistory.unshift({ courtId, players: bestCombo, round: round + 1 });
      roundMatches.push({ courtId, players: bestCombo, round: round + 1 });
    }
    results.push(roundMatches);

    // ---- 試合結果をシミュレート（50%ランダム勝敗） ----
    for (const match of roundMatches) {
      // 2vs2: 前半2人 vs 後半2人、ランダムでどちらが勝つか
      const winners = Math.random() < 0.5
        ? [match.players[0], match.players[1]]
        : [match.players[2], match.players[3]];
      const losers = match.players.filter(id => !winners.includes(id));

      // 勝者の序列変動
      for (const id of winners) {
        const prev = streaks.get(id) ?? 0;
        const newStreak = prev > 0 ? prev + 1 : 1;
        streaks.set(id, newStreak);

        const idx = order.indexOf(id);
        const currentGroupSize = Math.max(1, Math.floor(order.length / 3));
        if (newStreak >= 2 && newStreak % 2 === 0) {
          const newIdx = Math.max(0, idx - currentGroupSize);
          if (newIdx < idx) {
            order.splice(idx, 1);
            order.splice(newIdx, 0, id);
          }
        } else {
          if (idx > 0) {
            order.splice(idx, 1);
            order.splice(idx - 1, 0, id);
          }
        }
      }

      // 敗者の序列変動
      const currentGroupSize = Math.max(1, Math.floor(order.length / 3));
      let dropAmount = 0;
      if (dropMode === 'ceil2') {
        dropAmount = Math.max(1, Math.ceil(currentGroupSize / 2));
      } else if (dropMode === 'ceil3') {
        dropAmount = Math.max(1, Math.ceil(currentGroupSize / 3));
      }

      for (const id of losers) {
        streaks.set(id, 0);
        if (dropAmount > 0) {
          const idx = order.indexOf(id);
          const newIdx = Math.min(order.length - 1, idx + dropAmount);
          if (newIdx > idx) {
            order.splice(idx, 1);
            order.splice(newIdx, 0, id);
          }
        }
      }
    }

    // グループ変更カウント
    for (const id of order) {
      const prevGroup = prevGroups.get(id);
      const newGroup = getGroup(id);
      if (prevGroup !== newGroup) groupChanges++;
    }
  }

  return { crossGroupCount, deadlockCount, borrowCount, playerStats, groupChanges, uniqueOpponents };
}

// dropMode比較
const dropModes: { mode: 'none' | 'ceil2' | 'ceil3'; label: string }[] = [
  { mode: 'none', label: '敗北移動なし(現行)' },
  { mode: 'ceil3', label: '敗北ceil(gs/3)下がる' },
  { mode: 'ceil2', label: '敗北ceil(gs/2)下がる' },
];

console.log('  人数  グループ   方式                  cross  dead  borrow  grpChange  対戦相手数(avg)  公平性');
console.log('  ' + '-'.repeat(95));

for (const n of [14, 16, 18, 21]) {
  const gs = Math.floor(n / 3);
  const rem = n % 3;
  const groupLabel = `${gs}/${gs + rem}/${gs}`;

  for (const dm of dropModes) {
    let totalCross = 0, totalDead = 0, totalBorrow = 0, totalGrpChange = 0;
    let totalOpponents = 0, totalStddev = 0;
    const trials = 100;

    for (let t = 0; t < trials; t++) {
      const r = simulate3CourtsWithStreaks(n, 20, dm.mode);
      totalCross += r.crossGroupCount;
      totalDead += r.deadlockCount;
      totalBorrow += r.borrowCount;
      totalGrpChange += r.groupChanges;

      // 平均対戦相手数
      let oppSum = 0;
      for (const [, opps] of r.uniqueOpponents) {
        oppSum += opps.size;
      }
      totalOpponents += oppSum / n;

      // 公平性
      const games = Array.from(r.playerStats.values()).map(s => s.games);
      const avg = games.reduce((a, b) => a + b, 0) / games.length;
      totalStddev += Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);
    }

    console.log(
      `  ${String(n).padStart(2)}人  ${groupLabel.padEnd(9)} ` +
      `${dm.label.padEnd(22)} ` +
      `${(totalCross / trials).toFixed(1).padStart(5)} ` +
      `${(totalDead / trials).toFixed(1).padStart(5)} ` +
      `${(totalBorrow / trials).toFixed(1).padStart(7)} ` +
      `${(totalGrpChange / trials).toFixed(1).padStart(10)} ` +
      `${(totalOpponents / trials).toFixed(1).padStart(15)} ` +
      `${(totalStddev / trials).toFixed(2).padStart(7)}`
    );
  }
  console.log('');
}

// 21人の詳細: drop量の参考
console.log('  --- drop量の参考 ---');
for (const n of [14, 16, 18, 21]) {
  const gs = Math.floor(n / 3);
  const ceil2 = Math.max(1, Math.ceil(gs / 2));
  const ceil3 = Math.max(1, Math.ceil(gs / 3));
  console.log(`  ${n}人: groupSize=${gs}, ceil(gs/2)=${ceil2}(${Math.ceil(gs / ceil2)}敗で越え), ceil(gs/3)=${ceil3}(${Math.ceil(gs / ceil3)}敗で越え)`);
}

// ============================
// テスト16: 組み合わせ繰り返し検証（3回以上同じ4人組の出現頻度）
// ============================
console.log('\n### テスト16: 組み合わせ繰り返し検証（借用+敗北降下、100回平均、20ラウンド）');
console.log('  同じ4人の組が何回出現するかをセッション通算で計測\n');

function simulate3CourtsComboRepeat(
  totalPlayers: number,
  rounds: number,
  useComboRepeatPenalty: boolean,
): {
  comboRepeat3plus: number;  // 3回以上出現した組み合わせ数
  comboRepeat2: number;      // 2回出現した組み合わせ数
  maxRepeat: number;         // 最大繰り返し回数
  deadlockCount: number;
  borrowCount: number;
  stddev: number;
} {
  const order: string[] = [];
  const streaks = new Map<string, number>();
  const gamesPlayed = new Map<string, number>();

  const groupSize = Math.floor(totalPlayers / 3);
  const remainder = totalPlayers % 3;
  const upperSize = groupSize;
  const middleSize = groupSize + remainder;

  for (let i = 0; i < totalPlayers; i++) {
    const id = `P${i + 1}`;
    order.push(id);
    streaks.set(id, 0);
    gamesPlayed.set(id, 0);
  }

  // 全試合の組み合わせ（comboKey → 出現回数）
  const comboCount = new Map<string, number>();
  const matchHistory: SimMatch[] = [];
  let deadlockCount = 0;
  let borrowCount = 0;

  function getGroup(playerId: string): 'upper' | 'middle' | 'lower' {
    const idx = order.indexOf(playerId);
    if (idx < upperSize) return 'upper';
    if (idx < upperSize + middleSize) return 'middle';
    return 'lower';
  }

  for (let round = 0; round < rounds; round++) {
    const usedPlayers = new Set<string>();
    const roundMatches: SimMatch[] = [];

    for (let courtId = 1; courtId <= 3; courtId++) {
      const courtGroup = courtId === 1 ? 'upper' : courtId === 2 ? 'middle' : 'lower';

      const homeGroup = order
        .filter(id => getGroup(id) === courtGroup && !usedPlayers.has(id))
        .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }));
      homeGroup.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

      const adjacentCandidates: { id: string; gamesPlayed: number }[] = [];
      if (courtGroup === 'upper') {
        adjacentCandidates.push(
          ...order
            .filter(id => getGroup(id) === 'middle' && !usedPlayers.has(id))
            .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }))
        );
      } else if (courtGroup === 'lower') {
        adjacentCandidates.push(
          ...order
            .filter(id => getGroup(id) === 'middle' && !usedPlayers.has(id))
            .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }))
            .reverse()
        );
      } else {
        const up = order
          .filter(id => getGroup(id) === 'upper' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }))
          .reverse();
        const lo = order
          .filter(id => getGroup(id) === 'lower' && !usedPlayers.has(id))
          .map(id => ({ id, gamesPlayed: gamesPlayed.get(id) ?? 0 }));
        const maxLen = Math.max(up.length, lo.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < up.length) adjacentCandidates.push(up[i]);
          if (i < lo.length) adjacentCandidates.push(lo[i]);
        }
      }

      let bestCombo: string[] | null = null;
      let borrowed = 0;

      for (let expand = 0; expand <= adjacentCandidates.length; expand++) {
        const candidates = [...homeGroup];
        if (expand > 0) {
          candidates.push(...adjacentCandidates.slice(0, expand));
        }
        candidates.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
        if (candidates.length < 4) continue;

        let localBest: string[] | null = null;
        let localBestScore = Infinity;

        for (const combo of combinations4(candidates.map(c => c.id))) {
          if (hasSimilarRecentMatch(combo, matchHistory)) continue;
          let score = 0;
          for (const pid of combo) {
            score += gamesPlayed.get(pid) ?? 0;
            if (getGroup(pid) !== courtGroup) score += 3;
          }

          // 組み合わせ繰り返しペナルティ
          if (useComboRepeatPenalty) {
            const comboKey = [...combo].sort().join(',');
            const cnt = comboCount.get(comboKey) ?? 0;
            if (cnt >= 2) {
              score += 10; // 3回目以降を強く回避
            }
          }

          if (score < localBestScore) {
            localBestScore = score;
            localBest = combo;
          }
        }

        if (localBest) {
          bestCombo = localBest;
          borrowed = expand;
          break;
        }
      }

      if (!bestCombo) {
        deadlockCount++;
        const allAvailable = order
          .filter(id => !usedPlayers.has(id))
          .sort((a, b) => (gamesPlayed.get(a) ?? 0) - (gamesPlayed.get(b) ?? 0));
        bestCombo = allAvailable.slice(0, 4);
      }

      if (borrowed > 0) borrowCount++;

      // 組み合わせカウント
      const comboKey = [...bestCombo].sort().join(',');
      comboCount.set(comboKey, (comboCount.get(comboKey) ?? 0) + 1);

      for (const pid of bestCombo) {
        usedPlayers.add(pid);
        gamesPlayed.set(pid, (gamesPlayed.get(pid) ?? 0) + 1);
      }

      matchHistory.unshift({ courtId, players: bestCombo, round: round + 1 });
      roundMatches.push({ courtId, players: bestCombo, round: round + 1 });
    }

    // 勝敗シミュレート + 序列変動
    for (const match of roundMatches) {
      const winners = Math.random() < 0.5
        ? [match.players[0], match.players[1]]
        : [match.players[2], match.players[3]];
      const losers = match.players.filter(id => !winners.includes(id));

      for (const id of winners) {
        const prev = streaks.get(id) ?? 0;
        const newStreak = prev > 0 ? prev + 1 : 1;
        streaks.set(id, newStreak);
        const idx = order.indexOf(id);
        const currentGroupSize = Math.max(1, Math.floor(order.length / 3));
        if (newStreak >= 2 && newStreak % 2 === 0) {
          const newIdx = Math.max(0, idx - currentGroupSize);
          if (newIdx < idx) { order.splice(idx, 1); order.splice(newIdx, 0, id); }
        } else {
          if (idx > 0) { order.splice(idx, 1); order.splice(idx - 1, 0, id); }
        }
      }

      const currentGroupSize = Math.max(1, Math.floor(order.length / 3));
      const dropAmount = Math.max(1, Math.ceil(currentGroupSize / 2));
      for (const id of losers) {
        streaks.set(id, 0);
        const idx = order.indexOf(id);
        const newIdx = Math.min(order.length - 1, idx + dropAmount);
        if (newIdx > idx) { order.splice(idx, 1); order.splice(newIdx, 0, id); }
      }
    }
  }

  // 統計
  let comboRepeat2 = 0;
  let comboRepeat3plus = 0;
  let maxRepeat = 0;
  for (const [, count] of comboCount) {
    if (count >= 3) comboRepeat3plus++;
    if (count === 2) comboRepeat2++;
    if (count > maxRepeat) maxRepeat = count;
  }

  const games = Array.from(gamesPlayed.values());
  const avg = games.reduce((a, b) => a + b, 0) / games.length;
  const stddev = Math.sqrt(games.reduce((s, g) => s + (g - avg) ** 2, 0) / games.length);

  return { comboRepeat3plus, comboRepeat2, maxRepeat, deadlockCount, borrowCount, stddev };
}

console.log('  人数  方式                   2回組  3回+組  最大繰返  dead  borrow  公平性');
console.log('  ' + '-'.repeat(80));

for (const n of [14, 16, 18, 21]) {
  for (const usePenalty of [false, true]) {
    const label = usePenalty ? 'ペナルティあり' : 'ペナルティなし';

    let total2 = 0, total3plus = 0, totalMax = 0, totalDead = 0, totalBorrow = 0, totalStddev = 0;
    const trials = 100;

    for (let t = 0; t < trials; t++) {
      const r = simulate3CourtsComboRepeat(n, 20, usePenalty);
      total2 += r.comboRepeat2;
      total3plus += r.comboRepeat3plus;
      totalMax = Math.max(totalMax, r.maxRepeat);
      totalDead += r.deadlockCount;
      totalBorrow += r.borrowCount;
      totalStddev += r.stddev;
    }

    console.log(
      `  ${String(n).padStart(2)}人  ${label.padEnd(20)} ` +
      `${(total2 / trials).toFixed(1).padStart(5)} ` +
      `${(total3plus / trials).toFixed(1).padStart(6)} ` +
      `${String(totalMax).padStart(8)} ` +
      `${(totalDead / trials).toFixed(1).padStart(5)} ` +
      `${(totalBorrow / trials).toFixed(1).padStart(7)} ` +
      `${(totalStddev / trials).toFixed(2).padStart(7)}`
    );
  }
  console.log('');
}

console.log('\n' + '='.repeat(70));
console.log('シミュレーション完了');
console.log('='.repeat(70));
