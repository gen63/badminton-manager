import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculatePlayerStats, getStreaks, buildInitialOrder, applyStreakSwaps, assignCourts, formTeams } from './algorithm';
import type { Player } from '../types/player';
import type { Match } from '../types/match';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculatePlayerStats', () => {
  const createPlayer = (id: string, name: string): Player => ({
    id,
    name,
    gamesPlayed: 0,
    rating: 1500,
    isResting: false,
    lastPlayedAt: null,
    activatedAt: null,
  });

  const createMatch = (
    teamA: [string, string],
    teamB: [string, string],
    scoreA: number,
    scoreB: number
  ): Match => ({
    id: `match-${Date.now()}-${Math.random()}`,
    courtId: 1,
    teamA,
    teamB,
    scoreA,
    scoreB,
    winner: scoreA > scoreB ? 'A' : 'B',
    startedAt: Date.now(),
    finishedAt: Date.now(),
  });

  it('空の履歴では全員0試合', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
    ];

    const stats = calculatePlayerStats(players, []);

    expect(stats).toHaveLength(2);
    stats.forEach((s) => {
      expect(s.gamesPlayed).toBe(0);
      expect(s.wins).toBe(0);
      expect(s.losses).toBe(0);
      expect(s.points).toBe(0);
    });
  });

  it('1試合後の統計を正しく計算する', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
    ];

    const stats = calculatePlayerStats(players, matches);

    // チームA (p1, p2) が勝利
    const p1Stats = stats.find((s) => s.id === 'p1')!;
    const p2Stats = stats.find((s) => s.id === 'p2')!;
    expect(p1Stats.gamesPlayed).toBe(1);
    expect(p1Stats.wins).toBe(1);
    expect(p1Stats.losses).toBe(0);
    expect(p1Stats.points).toBe(21);

    expect(p2Stats.gamesPlayed).toBe(1);
    expect(p2Stats.wins).toBe(1);
    expect(p2Stats.losses).toBe(0);
    expect(p2Stats.points).toBe(21);

    // チームB (p3, p4) が敗北
    const p3Stats = stats.find((s) => s.id === 'p3')!;
    const p4Stats = stats.find((s) => s.id === 'p4')!;
    expect(p3Stats.gamesPlayed).toBe(1);
    expect(p3Stats.wins).toBe(0);
    expect(p3Stats.losses).toBe(1);
    expect(p3Stats.points).toBe(15);

    expect(p4Stats.gamesPlayed).toBe(1);
    expect(p4Stats.wins).toBe(0);
    expect(p4Stats.losses).toBe(1);
    expect(p4Stats.points).toBe(15);
  });

  it('複数試合の累計を正しく計算する', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // p1,p2勝利
      createMatch(['p1', 'p3'], ['p2', 'p4'], 15, 21), // p2,p4勝利
    ];

    const stats = calculatePlayerStats(players, matches);

    const p1Stats = stats.find((s) => s.id === 'p1')!;
    expect(p1Stats.gamesPlayed).toBe(2);
    expect(p1Stats.wins).toBe(1);
    expect(p1Stats.losses).toBe(1);
    expect(p1Stats.points).toBe(21 + 15);

    const p2Stats = stats.find((s) => s.id === 'p2')!;
    expect(p2Stats.gamesPlayed).toBe(2);
    expect(p2Stats.wins).toBe(2);
    expect(p2Stats.losses).toBe(0);
    expect(p2Stats.points).toBe(21 + 21);
  });

  it('試合に参加していないプレイヤーの統計は0', () => {
    const players = [
      createPlayer('p1', 'Player 1'),
      createPlayer('p2', 'Player 2'),
      createPlayer('p3', 'Player 3'),
      createPlayer('p4', 'Player 4'),
      createPlayer('p5', 'Player 5'), // 試合なし
    ];

    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
    ];

    const stats = calculatePlayerStats(players, matches);

    const p5Stats = stats.find((s) => s.id === 'p5')!;
    expect(p5Stats.gamesPlayed).toBe(0);
    expect(p5Stats.wins).toBe(0);
    expect(p5Stats.losses).toBe(0);
    expect(p5Stats.points).toBe(0);
  });
});

// ヘルパー（テスト共通）
const createPlayer = (id: string, name: string, rating: number = 1500): Player => ({
  id,
  name,
  gamesPlayed: 0,
  rating,
  isResting: false,
  lastPlayedAt: null,
  activatedAt: null,
});

const createMatch = (
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number
): Match => ({
  id: `match-${Date.now()}-${Math.random()}`,
  courtId: 1,
  teamA,
  teamB,
  scoreA,
  scoreB,
  winner: scoreA > scoreB ? 'A' : 'B',
  startedAt: Date.now(),
  finishedAt: Date.now(),
});

describe('getStreaks', () => {
  it('空の履歴では空のMap', () => {
    expect(getStreaks([]).size).toBe(0);
  });

  it('1勝で連勝1', () => {
    // matchHistoryは新しい順（先頭が最新）
    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(1);
    expect(streaks.get('p2')).toBe(1);
    expect(streaks.get('p3')).toBe(-1);
    expect(streaks.get('p4')).toBe(-1);
  });

  it('二連勝で連勝2', () => {
    // 新しい順: match2が先頭
    const matches = [
      createMatch(['p1', 'p2'], ['p5', 'p6'], 21, 15), // 2試合目（最新）
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(2);
    expect(streaks.get('p2')).toBe(2);
  });

  it('勝ち→負けで連勝リセット', () => {
    const matches = [
      createMatch(['p3', 'p4'], ['p1', 'p2'], 21, 15), // 2試合目: p1負け（最新）
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目: p1勝ち
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(-1);
  });

  it('三連勝で連勝3', () => {
    const matches = [
      createMatch(['p1', 'p2'], ['p7', 'p8'], 21, 15), // 3試合目（最新）
      createMatch(['p1', 'p2'], ['p5', 'p6'], 21, 15), // 2試合目
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(3);
  });
});

describe('buildInitialOrder', () => {
  it('レーティング降順で並ぶ', () => {
    const players = [
      createPlayer('A', 'A', 1800),
      createPlayer('B', 'B', 1600),
      createPlayer('C', 'C', 1400),
    ];
    expect(buildInitialOrder(players)).toEqual(['A', 'B', 'C']);
  });

  it('レーティング0のプレイヤーはmiddle位置に挿入', () => {
    const players = [
      createPlayer('A', 'A', 1800),
      createPlayer('B', 'B', 1600),
      createPlayer('C', 'C', 1400),
      createPlayer('X', 'X', 0),
      createPlayer('D', 'D', 1200),
      createPlayer('E', 'E', 1000),
    ];
    const order = buildInitialOrder(players);
    // rated: A > B > C > D > E (5人), middleStart = floor(5/3) = 1
    // → A, X, B, C, D, E
    expect(order).toEqual(['A', 'X', 'B', 'C', 'D', 'E']);
  });

  it('レーティング0が複数いる場合', () => {
    const players = [
      createPlayer('A', 'A', 1800),
      createPlayer('B', 'B', 1600),
      createPlayer('C', 'C', 1400),
      createPlayer('X', 'X', 0),
      createPlayer('Y', 'Y', 0),
      createPlayer('D', 'D', 1200),
    ];
    const order = buildInitialOrder(players);
    // rated: A > B > C > D (4人), middleStart = floor(4/3) = 1
    // → A, X, Y, B, C, D
    expect(order).toEqual(['A', 'X', 'Y', 'B', 'C', 'D']);
  });

  it('全員レーティング0の場合', () => {
    const players = [
      createPlayer('X', 'X', 0),
      createPlayer('Y', 'Y', 0),
    ];
    const order = buildInitialOrder(players);
    // rated: 0人, middleStart = 0 → 全員先頭に
    expect(order).toEqual(['X', 'Y']);
  });
});

describe('applyStreakSwaps', () => {
  it('履歴なしで序列変化なし', () => {
    const order = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(applyStreakSwaps(order, [])).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('二連勝で1つ上+グループ1つ分上に移動', () => {
    // D が二連勝: matchHistoryは新しい順
    const matches = [
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 2試合目（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 1勝目: D(3)が1つ上 → A,B,D,C,E,F
    // 2連勝目: D(2)がstepSize=2つ上 → D,A,B,C,E,F
    expect(order).toEqual(['D', 'A', 'B', 'C', 'E', 'F']);
  });

  it('二連敗でceil(gs/2)ずつ下に移動', () => {
    // D が二連敗 (stepSize=2, dropAmount=ceil(2/2)=1)
    const matches = [
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目（最新）
      createMatch(['W', 'V'], ['D', 'X'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 1敗目: D(3)→4 → A,B,C,E,D,F
    // 2敗目: D(4)→5 → A,B,C,E,F,D
    expect(order).toEqual(['A', 'B', 'C', 'E', 'F', 'D']);
  });

  it('三連勝で1勝+2連勝+1勝の移動', () => {
    const matches = [
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 3試合目（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 2試合目
      createMatch(['D', 'X'], ['U', 'T'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 1勝目: D(3)→1つ上 → A,B,D,C,E,F
    // 2連勝目: D(2)→2つ上 → D,A,B,C,E,F
    // 3勝目: D(0)→既にtop、変化なし
    expect(order).toEqual(['D', 'A', 'B', 'C', 'E', 'F']);
  });

  it('四連勝でも既にtopなら変化なし', () => {
    const matches = [
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 4試合目（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 3試合目
      createMatch(['D', 'X'], ['U', 'T'], 21, 15), // 2試合目
      createMatch(['D', 'X'], ['S', 'R'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 1勝+2連勝でtopに到達、以降は変化なし
    expect(order).toEqual(['D', 'A', 'B', 'C', 'E', 'F']);
  });

  it('最上位での二連勝は変化なし', () => {
    const matches = [
      createMatch(['A', 'X'], ['Y', 'Z'], 21, 15),
      createMatch(['A', 'X'], ['W', 'V'], 21, 15),
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C'],
      matches
    );
    // A は既に最上位（index 0）なので交代先がない
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('最下位での敗北はそれ以上下がらない', () => {
    const matches = [
      createMatch(['Y', 'Z'], ['C', 'X'], 21, 15),
      createMatch(['W', 'V'], ['C', 'X'], 21, 15),
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C'],
      matches
    );
    // C は既に最下位なのでこれ以上下がらない
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('勝ち→負けで上昇分を降下が相殺', () => {
    const matches = [
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目: D負け（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目: D勝ち
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 1勝目: D(3)→1つ上 → A,B,D,C,E,F
    // 2試合目: D負け → 1つ下 → A,B,C,D,E,F（元に戻る）
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('assignCourts - 2コートホリスティック配置', () => {
  const now = Date.now();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRatedPlayer = (
    id: string,
    name: string,
    rating: number,
    gamesPlayed: number = 0
  ): Player => ({
    id,
    name,
    gamesPlayed,
    rating,
    isResting: false,
    lastPlayedAt: null,
    activatedAt: now - 60 * 60 * 1000, // 1時間前
  });

  const make8Players = () => [
    createRatedPlayer('p1', 'P1', 2000),
    createRatedPlayer('p2', 'P2', 1800),
    createRatedPlayer('p3', 'P3', 1600),
    createRatedPlayer('p4', 'P4', 1400),
    createRatedPlayer('p5', 'P5', 1200),
    createRatedPlayer('p6', 'P6', 1000),
    createRatedPlayer('p7', 'P7', 800),
    createRatedPlayer('p8', 'P8', 600),
  ];

  const defaultOptions = {
    totalCourtCount: 2,
    targetCourtIds: [1, 2],
    practiceStartTime: now - 60 * 60 * 1000,
  };

  it('レート順に配置される傾向がある', () => {
    const assignments = assignCourts(make8Players(), 2, [], defaultOptions);

    const allAssigned = assignments.flatMap(a => [...a.teamA, ...a.teamB]);
    expect(allAssigned).toHaveLength(8);
    expect(new Set(allAssigned).size).toBe(8); // 重複なし

    // レートが高いプレイヤーが優先的に配置される傾向があることを確認
    const assignedSet = new Set(allAssigned);
    expect(assignedSet.has('p1')).toBe(true); // 最高レート
    expect(assignedSet.has('p8')).toBe(true); // 最低レート
  });

  it('連勝によるストリークが配置に影響する', () => {
    // p5が二連勝 → 序列が上がりやすくなる
    const matches = [
      createMatch(['p5', 'X'], ['Y', 'Z'], 21, 15),
      createMatch(['p5', 'X'], ['W', 'V'], 21, 15),
    ];

    const assignments = assignCourts(make8Players(), 2, matches, defaultOptions);
    const allAssigned = assignments.flatMap(a => [...a.teamA, ...a.teamB]);

    expect(allAssigned).toHaveLength(8);
    expect(allAssigned).toContain('p5'); // ストリークのあるプレイヤーが配置される
  });

  it('ランダム性のある配置が行われる', () => {
    const players = make8Players();
    
    // 同じ入力で複数回実行して、結果が異なることを確認
    const results = [];
    for (let i = 0; i < 5; i++) {
      const assignments = assignCourts(players, 2, [], defaultOptions);
      const court1Players = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
      results.push([...court1Players].sort());
    }
    
    // 少なくとも1つは異なる結果があることを確認（ランダム性がある）
    const uniqueResults = new Set(results.map(r => r.join(',')));
    expect(uniqueResults.size).toBeGreaterThan(1);
  });

  it('15人の場合、優先度の高い8人が選ばれる', () => {
    const players = [
      ...make8Players(), // gamesPlayed=0 → 最優先
      createRatedPlayer('p9', 'P9', 1900, 5),
      createRatedPlayer('p10', 'P10', 1700, 5),
      createRatedPlayer('p11', 'P11', 1500, 5),
      createRatedPlayer('p12', 'P12', 1300, 5),
      createRatedPlayer('p13', 'P13', 1100, 5),
      createRatedPlayer('p14', 'P14', 900, 5),
      createRatedPlayer('p15', 'P15', 700, 5),
    ];

    const assignments = assignCourts(players, 2, [], defaultOptions);
    const allAssigned = assignments.flatMap(a => [...a.teamA, ...a.teamB]);

    expect(allAssigned).toHaveLength(8);
    // gamesPlayed=0のプレイヤーが優先的に選ばれるはず
    const assignedSet = new Set(allAssigned);
    const lowGamesPlayers = players.filter(p => p.gamesPlayed === 0).map(p => p.id);
    lowGamesPlayers.forEach(id => {
      expect(assignedSet.has(id)).toBe(true);
    });
  });

  it('各コートに正しく4人ずつ配置される（ランダムあり）', () => {
    // ランダム性があっても構造は常に正しい
    for (let i = 0; i < 20; i++) {
      const assignments = assignCourts(make8Players(), 2, [], defaultOptions);

      expect(assignments).toHaveLength(2);
      assignments.forEach(a => {
        expect(a.teamA).toHaveLength(2);
        expect(a.teamB).toHaveLength(2);
      });

      const allPlayers = assignments.flatMap(a => [...a.teamA, ...a.teamB]);
      expect(new Set(allPlayers).size).toBe(8);
    }
  });

  it('休憩中のプレイヤーは配置されない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const players = [
      ...make8Players(),
      { ...createRatedPlayer('p9', 'P9', 2500), isResting: true },
    ];

    const assignments = assignCourts(players, 2, [], defaultOptions);
    const allAssigned = assignments.flatMap(a => [...a.teamA, ...a.teamB]);
    expect(allAssigned).not.toContain('p9');
  });

  it('1コート配置時: allPlayersでグローバルなupper/lower判定が行われる', () => {
    // 全アクティブ15人（p1-p15）
    const allPlayers = Array.from({ length: 15 }, (_, i) =>
      createRatedPlayer(`p${i + 1}`, `P${i + 1}`, 2000 - i * 100)
    );

    // p1-p4はコート2でプレイ中 → 待機プレイヤーはp5-p15の11人
    const waitingPlayers = allPlayers.slice(4);

    // コート1（upperコート）に配置
    const assignments = assignCourts(waitingPlayers, 1, [], {
      totalCourtCount: 2,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      allPlayers,  // 全15人でグループ分け
    });

    expect(assignments).toHaveLength(1);
    const assigned = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(assigned).toHaveLength(4);

    // グローバルupperの中で待機中のプレイヤーが優先的に配置される
    const assignedSet = new Set(assigned);
    expect(assignedSet.has('p5') || assignedSet.has('p6') || assignedSet.has('p7')).toBe(true);
  });

  it('1コート配置時: allPlayersなしだと待機者だけでグループ分けされる', () => {
    // 全アクティブ15人だが、allPlayersを渡さない
    const allPlayers = Array.from({ length: 15 }, (_, i) =>
      createRatedPlayer(`p${i + 1}`, `P${i + 1}`, 2000 - i * 100)
    );
    const waitingPlayers = allPlayers.slice(4); // p5-p15

    // allPlayers未指定 → 待機者(p5-p15)だけでグループ分け
    const assignments = assignCourts(waitingPlayers, 1, [], {
      totalCourtCount: 2,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      // allPlayers未指定
    });

    const assigned = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(assigned).toHaveLength(4);
    // 待機者の中から選ばれる
    assigned.forEach(id => {
      expect(id.startsWith('p')).toBe(true);
      const num = parseInt(id.slice(1));
      expect(num).toBeGreaterThanOrEqual(5);
    });
  });
});

describe('formTeams - MIXペアリング', () => {
  const createGenderedPlayer = (
    id: string, name: string, rating: number, gender: 'M' | 'F'
  ): Player => ({
    id, name, rating, gender,
    gamesPlayed: 0, isResting: false, lastPlayedAt: null, activatedAt: null,
  });

  it('2M+2Fでデフォルト（1+4 vs 2+3）がMF → そのまま', () => {
    // 序列: M, F, F, M → 1+4=MM? いや、1位M+4位M=MM → デフォルトではMIXにならない
    // 序列: M, F, M, F → 1+4=MF, 2+3=FM → MIX ✓
    const players = [
      createGenderedPlayer('p1', 'P1', 2000, 'M'),
      createGenderedPlayer('p2', 'P2', 1800, 'F'),
      createGenderedPlayer('p3', 'P3', 1600, 'M'),
      createGenderedPlayer('p4', 'P4', 1400, 'F'),
    ];
    const order = ['p1', 'p2', 'p3', 'p4'];
    const result = formTeams(players, order);

    // 1+4 vs 2+3 → MF vs FM
    expect(result.teamA).toEqual(['p1', 'p4']);
    expect(result.teamB).toEqual(['p2', 'p3']);
  });

  it('2M+2Fでデフォルトが同性 → 代替ペアリングでMIXに', () => {
    // 序列: M, F, F, M → デフォルト 1+4=MM, 2+3=FF → 同性 → 代替へ
    const players = [
      createGenderedPlayer('p1', 'P1', 2000, 'M'),
      createGenderedPlayer('p2', 'P2', 1800, 'F'),
      createGenderedPlayer('p3', 'P3', 1600, 'F'),
      createGenderedPlayer('p4', 'P4', 1400, 'M'),
    ];
    const order = ['p1', 'p2', 'p3', 'p4'];
    const result = formTeams(players, order);

    // 代替: 1+3 vs 2+4 → MF vs FM
    expect(result.teamA).toEqual(['p1', 'p3']);
    expect(result.teamB).toEqual(['p2', 'p4']);
  });

  it('4M（同性のみ）→ デフォルトのまま', () => {
    const players = [
      createGenderedPlayer('p1', 'P1', 2000, 'M'),
      createGenderedPlayer('p2', 'P2', 1800, 'M'),
      createGenderedPlayer('p3', 'P3', 1600, 'M'),
      createGenderedPlayer('p4', 'P4', 1400, 'M'),
    ];
    const order = ['p1', 'p2', 'p3', 'p4'];
    const result = formTeams(players, order);

    expect(result.teamA).toEqual(['p1', 'p4']);
    expect(result.teamB).toEqual(['p2', 'p3']);
  });

  it('性別未設定あり → デフォルトのまま', () => {
    const players: Player[] = [
      createGenderedPlayer('p1', 'P1', 2000, 'M'),
      createGenderedPlayer('p2', 'P2', 1800, 'F'),
      { id: 'p3', name: 'P3', rating: 1600, gamesPlayed: 0, isResting: false, lastPlayedAt: null, activatedAt: null },
      createGenderedPlayer('p4', 'P4', 1400, 'M'),
    ];
    const order = ['p1', 'p2', 'p3', 'p4'];
    const result = formTeams(players, order);

    // 性別未設定がいるのでデフォルト
    expect(result.teamA).toEqual(['p1', 'p4']);
    expect(result.teamB).toEqual(['p2', 'p3']);
  });
});

describe('assignCourts - 性別ペナルティ', () => {
  const now = Date.now();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createGenderedPlayer = (
    id: string, name: string, rating: number, gender: 'M' | 'F',
    gamesPlayed: number = 1
  ): Player => ({
    id, name, rating, gender, gamesPlayed,
    isResting: false, lastPlayedAt: null,
    activatedAt: now - 60 * 60 * 1000,
  });

  it('同優先度で2M+2Fが3M+1Fより優先される', () => {
    // 5人: M1, M2, M3, F1, F2 （全員同じ優先度）
    const players = [
      createGenderedPlayer('m1', 'M1', 1500, 'M'),
      createGenderedPlayer('m2', 'M2', 1500, 'M'),
      createGenderedPlayer('m3', 'M3', 1500, 'M'),
      createGenderedPlayer('f1', 'F1', 1500, 'F'),
      createGenderedPlayer('f2', 'F2', 1500, 'F'),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
    });

    const assigned = [...assignments[0].teamA, ...assignments[0].teamB];
    const maleCount = assigned.filter(id => id.startsWith('m')).length;
    const femaleCount = assigned.filter(id => id.startsWith('f')).length;

    // バランスの取れた組み合わせが優先される傾向がある
    expect(maleCount + femaleCount).toBe(4);
    expect(Math.abs(maleCount - femaleCount)).toBeLessThanOrEqual(1);
  });

  it('優先度差が大きい場合は性別より優先度が勝つ', () => {
    // M1: gamesPlayed=0（最優先）, M2,M3: gamesPlayed=0, F1: gamesPlayed=5（低優先度）, F2: gamesPlayed=5
    const players = [
      createGenderedPlayer('m1', 'M1', 1500, 'M', 0),
      createGenderedPlayer('m2', 'M2', 1500, 'M', 0),
      createGenderedPlayer('m3', 'M3', 1500, 'M', 0),
      createGenderedPlayer('m4', 'M4', 1500, 'M', 0),
      createGenderedPlayer('f1', 'F1', 1500, 'F', 5),
      createGenderedPlayer('f2', 'F2', 1500, 'F', 5),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
    });

    const assigned = [...assignments[0].teamA, ...assignments[0].teamB];

    // 優先度が高いプレイヤーが選ばれる
    const assignedSet = new Set(assigned);
    expect(assignedSet.has('m1')).toBe(true);
    expect(assignedSet.has('m2')).toBe(true);
    expect(assignedSet.has('m3')).toBe(true);
    expect(assignedSet.has('m4')).toBe(true);
  });
});
