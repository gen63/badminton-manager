import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { calculatePlayerStats, getStreaks, buildInitialOrder, applyStreakSwaps, assignCourts, formTeams, sortWaitingPlayers } from './algorithm';
import type { Player } from '../types/player';
import type { Match } from '../types/match';
import type { Reservation } from '../types/reservation';

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
    lastPlayedAt: 0,
    activatedAt: 0,
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
  lastPlayedAt: 0,
  activatedAt: 0,
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
    // matchHistory は古い順（先頭が最も古い、末尾が最新）
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
    // 古い順: match1 が先頭、match2（最新）が末尾
    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目（古）
      createMatch(['p1', 'p2'], ['p5', 'p6'], 21, 15), // 2試合目（最新）
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(2);
    expect(streaks.get('p2')).toBe(2);
  });

  it('勝ち→負けで連勝リセット', () => {
    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目: p1勝ち（古）
      createMatch(['p3', 'p4'], ['p1', 'p2'], 21, 15), // 2試合目: p1負け（最新）
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(-1);
  });

  it('三連勝で連勝3', () => {
    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 1試合目（古）
      createMatch(['p1', 'p2'], ['p5', 'p6'], 21, 15), // 2試合目
      createMatch(['p1', 'p2'], ['p7', 'p8'], 21, 15), // 3試合目（最新）
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(3);
  });

  it('負け→勝ち→勝ち の場合、連勝 2（直近 2 試合勝ち）', () => {
    // 順序バグの retort case
    const matches = [
      createMatch(['p3', 'p4'], ['p1', 'p2'], 21, 15), // 1試合目: p1負け（古）
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15), // 2試合目: p1勝ち
      createMatch(['p1', 'p2'], ['p5', 'p6'], 21, 15), // 3試合目: p1勝ち（最新）
    ];
    const streaks = getStreaks(matches);
    expect(streaks.get('p1')).toBe(2);
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
    // D が二連勝: matchHistory は古い順（先頭が最も古い）
    const matches = [
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目（古）
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 2試合目（最新）
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
      createMatch(['W', 'V'], ['D', 'X'], 21, 15), // 1試合目（古）
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目（最新）
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
      createMatch(['D', 'X'], ['U', 'T'], 21, 15), // 1試合目（古）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 2試合目
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 3試合目（最新）
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
      createMatch(['D', 'X'], ['S', 'R'], 21, 15), // 1試合目（古）
      createMatch(['D', 'X'], ['U', 'T'], 21, 15), // 2試合目
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 3試合目
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 4試合目（最新）
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
      createMatch(['A', 'X'], ['W', 'V'], 21, 15),
      createMatch(['A', 'X'], ['Y', 'Z'], 21, 15),
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
      createMatch(['W', 'V'], ['C', 'X'], 21, 15),
      createMatch(['Y', 'Z'], ['C', 'X'], 21, 15),
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
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目: D勝ち（古）
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目: D負け（最新）
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
    lastPlayedAt: 0,
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
    gamesPlayed: 0, isResting: false, lastPlayedAt: 0, activatedAt: 0,
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
      { id: 'p3', name: 'P3', rating: 1600, gamesPlayed: 0, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
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
    isResting: false, lastPlayedAt: 0,
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

describe('assignCourts (シングルス)', () => {
  const NOW = 1730000000000; // 固定の現在時刻

  const createSinglesPlayer = (
    id: string,
    opts: Partial<Player> = {}
  ): Player => ({
    id,
    name: id.toUpperCase(),
    rating: 1500,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * 60 * 1000, // 1時間前にチェックイン
    ...opts,
  });

  const createSinglesMatch = (
    aId: string,
    bId: string,
    finishedAt: number
  ): Match => ({
    id: `m-${aId}-${bId}-${finishedAt}`,
    courtId: 1,
    teamA: [aId, ''],
    teamB: [bId, ''],
    scoreA: 21,
    scoreB: 15,
    winner: 'A',
    startedAt: finishedAt - 10 * 60 * 1000,
    finishedAt,
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('4人/1コート: 1ペアが配置される', () => {
    const players = [
      createSinglesPlayer('a'),
      createSinglesPlayer('b'),
      createSinglesPlayer('c'),
      createSinglesPlayer('d'),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].teamA[1]).toBe('');
    expect(assignments[0].teamB[1]).toBe('');
    const ids = [assignments[0].teamA[0], assignments[0].teamB[0]];
    expect(ids.every(id => id !== '')).toBe(true);
  });

  it('総当たり優先: 未対戦ペアが選ばれる', () => {
    // a-b が3回対戦、その他は未対戦
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 3, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 3, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 0 }),
      createSinglesPlayer('d', { gamesPlayed: 0 }),
    ];
    const history = [
      createSinglesMatch('a', 'b', NOW - 50 * 60 * 1000),
      createSinglesMatch('a', 'b', NOW - 40 * 60 * 1000),
      createSinglesMatch('a', 'b', NOW - 30 * 60 * 1000),
    ];

    const assignments = assignCourts(players, 1, history, {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    });

    const pair = [assignments[0].teamA[0], assignments[0].teamB[0]].sort();
    expect(pair).not.toEqual(['a', 'b']);
  });

  it('多コート同時: グリーディだと損する組合せでも全体最適が選ばれる', () => {
    // 過去対戦: a-b, a-c, a-d, b-c (a と c-d が未対戦; b と d が未対戦)
    // グリーディだと a を最高優先で a-c (or a-d) を取り、b と c-d の片方が同じ
    // 過去ペアとぶつかる。全体最適なら a-d / b-c (b-c は既出) → a-c / b-d 等
    //
    // よりシンプルな例: 4人 a,b,c,d で 2 コート割り当て不可（4人で1コート分のみ）。
    // 6人で 2 コート: a-b, c-d が過去対戦、a-c が未対戦、b-d が未対戦。
    // グリーディが a-c, b-d を選ばずに a-b, c-d を選びうるパターンを再現する。
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 1, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 1, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 1, lastPlayedAt: NOW - 30 * 60 * 1000 }),
    ];
    const history = [
      createSinglesMatch('a', 'b', NOW - 40 * 60 * 1000),
      createSinglesMatch('c', 'd', NOW - 35 * 60 * 1000),
    ];

    const assignments = assignCourts(players, 2, history, {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    });

    expect(assignments).toHaveLength(2);
    const pairs = assignments.map(a => [a.teamA[0], a.teamB[0]].sort().join('-')).sort();
    // 過去対戦の a-b と c-d が同時には選ばれない
    expect(pairs.includes('a-b') && pairs.includes('c-d')).toBe(false);
  });

  it('連続回避: 直前にプレイしたユーザを含むペアより、休息中ペアが優先される', () => {
    // a-c, b-d は同じ matchCount=0, 同じ rating
    // a, b は直前にプレイ (lastPlayedAt = NOW - 1分)。c, d は古い (NOW - 60分)
    // → 休息ペアが選ばれる... が、4人だと両方含まれてしまう。
    // 6 人で1コート、a-b が休んでいない最近プレイ、c-d-e-f は休息中なら選ばれるはず
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 1 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 1, lastPlayedAt: NOW - 1 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('e', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('f', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const picked = new Set([assignments[0].teamA[0], assignments[0].teamB[0]]);
    expect(picked.has('a')).toBe(false);
    expect(picked.has('b')).toBe(false);
  });

  it('レーティング近接: 他条件が拮抗時に近いレーティングが選ばれる', () => {
    // 全員 gamesPlayed=1, lastPlayedAt=古い (=ペナルティ無し), 未対戦
    // 候補プールは a(1400), b(1500), c(1550), d(1700)
    // 最適は b-c (差50) と a-d (差300) で合計350、あるいは a-b と c-d (差100+150=250)
    // 期待: a-b, c-d ペアの方が rating diff 合計が小さいので選ばれる
    const players = [
      createSinglesPlayer('a', { rating: 1400, gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { rating: 1500, gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { rating: 1550, gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { rating: 1700, gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 2, [], {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const pairs = assignments.map(a => [a.teamA[0], a.teamB[0]].sort().join('-')).sort();
    expect(pairs).toEqual(['a-b', 'c-d']);
  });

  it('gamesPlayed=0 の初回保証: 試合多い人より優先', () => {
    // a は未プレイ、b-e は3試合
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 0 }),
      createSinglesPlayer('b', { gamesPlayed: 3, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 3, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 3, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('e', { gamesPlayed: 3, lastPlayedAt: NOW - 30 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    });

    const picked = new Set([assignments[0].teamA[0], assignments[0].teamB[0]]);
    expect(picked.has('a')).toBe(true);
  });

  it('最大偏差フィルタ: 平均+3超過は除外される', () => {
    // a: 1試合, b-d: 1試合, e: 10試合 (平均より大きく多い)
    // 候補プールから e は除外される
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('e', { gamesPlayed: 10, lastPlayedAt: NOW - 60 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 2, [], {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    });

    const picked = new Set(assignments.flatMap(a => [a.teamA[0], a.teamB[0]]));
    expect(picked.has('e')).toBe(false);
  });

  it('プレイヤー不足では insufficient-players エラーを投げる', () => {
    const players = [createSinglesPlayer('a')];
    expect(() => assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      gameMode: 'singles',
    })).toThrow();
  });

  it('連続回避 > 総当たり: 直前プレイ者を含む未対戦ペアより、対戦済みでも休息中ペアが選ばれる', () => {
    // a,b: 過去1回対戦、60分休息 → 過去対戦ペナルティはあるが休んでいる
    // c,d: 未対戦、1分前にプレイ → 総当たり的には嬉しいが直前にプレイ
    // 「連続回避が一番強い」なら (a,b) が選ばれる
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 2, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 2, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 2, lastPlayedAt: NOW - 1 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 2, lastPlayedAt: NOW - 1 * 60 * 1000 }),
    ];
    const history = [createSinglesMatch('a', 'b', NOW - 40 * 60 * 1000)];

    const assignments = assignCourts(players, 1, history, {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const picked = [assignments[0].teamA[0], assignments[0].teamB[0]].sort();
    expect(picked).toEqual(['a', 'b']);
  });

  it('連続回避 > 試合数均等: 直前プレイのプレイヤーは試合数が少なくても外される', () => {
    // a: gamesPlayed=1, 1分前にプレイ（直前）
    // b, c, d: gamesPlayed=3, 60分休息
    // balance だけ見ると a が最優先だが、recency 重視で b/c/d から 2 人選ばれる
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 1 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 3, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 3, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 3, lastPlayedAt: NOW - 60 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const picked = new Set([assignments[0].teamA[0], assignments[0].teamB[0]]);
    expect(picked.has('a')).toBe(false);
  });

  it('試合数均等化: RR 同点時に gamesPlayed 合計が低いペアが選ばれる', () => {
    // 全員未対戦、 a-b は 1+1=2 試合、c-d は 5+5=10 試合、6人で 1 コート
    // 全員 lastPlayedAt は十分古い（レシピは同じ）
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 2, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 2, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      // 平均+3 を超えない範囲で他に同 gamesPlayed を増やしすぎないこと
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const picked = [assignments[0].teamA[0], assignments[0].teamB[0]].sort();
    // gamesPlayed 合計が低い a-b ペアが選ばれる
    expect(picked).toEqual(['a', 'b']);
  });
});

describe('assignCourts - 後半均等化モード (lateBalanceMode)', () => {
  const NOW = Date.now();

  const createGenderedPlayer = (
    id: string,
    gender: 'M' | 'F',
    gamesPlayed: number,
  ): Player => ({
    id,
    name: id.toUpperCase(),
    gender,
    rating: 1500,
    gamesPlayed,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * 60 * 1000,
  });

  it('lateBalanceMode=true で試合数の少ない異性が 3-1 ペナルティを上回って配置される (gap=2)', () => {
    // p1-p4: 男性、gp=10 (全員 4-0 構成にすればペナルティ無し)
    // p5: 女性、gp=8 (gap=2)。lateBalance ペナルティ -4.0 が gender 3-1 ペナルティ +3.0 を上回り
    //     {p1,p2,p3,p5} が選ばれるはず
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 10),
      createGenderedPlayer('p3', 'M', 10),
      createGenderedPlayer('p4', 'M', 10),
      createGenderedPlayer('p5', 'F', 8),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      lateBalanceMode: true,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p5')).toBe(true);
    expect(picked.size).toBe(4);
  });

  it('lateBalanceMode=false (既定) では同シナリオで gender 3-1 が回避され男性 4人が選ばれる', () => {
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 10),
      createGenderedPlayer('p3', 'M', 10),
      createGenderedPlayer('p4', 'M', 10),
      createGenderedPlayer('p5', 'F', 8),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      // lateBalanceMode: false (default)
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    // 4-0 (同性) が 3-1 より優先されるので p5 (F) は選ばれない
    expect(picked.has('p5')).toBe(false);
  });

  it('lateBalanceMode=true でも gap=1 のときは gender 3-1 が依然回避される', () => {
    // gap=1 → lateBalance ペナルティ -2.0 が gender 3-1 ペナルティ +3.0 に劣る
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 10),
      createGenderedPlayer('p3', 'M', 10),
      createGenderedPlayer('p4', 'M', 10),
      createGenderedPlayer('p5', 'F', 9),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      lateBalanceMode: true,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p5')).toBe(false);
  });

  it('sortWaitingPlayers: lateBalanceMode=true で試合数が少ない人が前に来る', () => {
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 5),
      createGenderedPlayer('p3', 'M', 10),
    ];

    const sorted = sortWaitingPlayers(players, {
      emptyCourtIds: [],
      totalCourtCount: 1,
      matchHistory: [],
      allActivePlayers: players,
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDuration: false,
      lateBalanceMode: true,
    });

    expect(sorted[0].id).toBe('p2');
  });
});

describe('assignCourts - 予約の試合数による保留 (reservationBlockThreshold)', () => {
  const NOW = Date.now();

  const makePlayer = (id: string, gamesPlayed: number): Player => ({
    id,
    name: id.toUpperCase(),
    rating: 1500,
    gamesPlayed,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * 60 * 1000,
  });

  const makeReservation = (playerIds: string[]): Reservation => ({
    id: `rsv-${playerIds.join('-')}`,
    orderNumber: 1,
    playerIds,
    status: 'pending',
    createdAt: NOW,
    fulfilledAt: 0,
  });

  // p1 のみ試合数が突出。残りは 0。中央値 = 0。
  const makePlayers = () => [
    makePlayer('p1', 10),
    makePlayer('p2', 0),
    makePlayer('p3', 0),
    makePlayer('p4', 0),
    makePlayer('p5', 0),
    makePlayer('p6', 0),
    makePlayer('p7', 0),
    makePlayer('p8', 0),
  ];

  const baseOptions = {
    totalCourtCount: 1,
    targetCourtIds: [1],
    practiceStartTime: NOW - 60 * 60 * 1000,
    useStayDurationPriority: false,
  };

  it('予約メンバーの試合数が中央値+閾値以上だと予約全体が保留される', () => {
    const players = makePlayers();
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      reservationBlockThreshold: 2, // p1 の gap=10 >= 2 → 保留
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    // 予約全体が保留され、p1-p4 は誰も配置されない（通常配置からも除外）
    expect(picked.has('p1')).toBe(false);
    expect(picked.has('p2')).toBe(false);
    expect(picked.has('p3')).toBe(false);
    expect(picked.has('p4')).toBe(false);
  });

  it('閾値を上げて gap を下回らせると、その予約は通常どおり配置される', () => {
    const players = makePlayers();
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      reservationBlockThreshold: 11, // p1 の gap=10 < 11 → 保留しない
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p1')).toBe(true);
    expect(picked.size).toBe(4);
  });

  it('gap が閾値ちょうどでも保留される（>= 判定）', () => {
    // p1=2, 他=0 → 中央値 0、gap=2、閾値 2 → 保留
    const players = [
      makePlayer('p1', 2),
      makePlayer('p2', 0),
      makePlayer('p3', 0),
      makePlayer('p4', 0),
      makePlayer('p5', 0),
      makePlayer('p6', 0),
      makePlayer('p7', 0),
      makePlayer('p8', 0),
    ];
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      reservationBlockThreshold: 2,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p1')).toBe(false);
  });

  it('gap が閾値未満なら保留されない', () => {
    // p1=1, 他=0 → 中央値 0、gap=1 < 2 → 配置される
    const players = [
      makePlayer('p1', 1),
      makePlayer('p2', 0),
      makePlayer('p3', 0),
      makePlayer('p4', 0),
      makePlayer('p5', 0),
      makePlayer('p6', 0),
      makePlayer('p7', 0),
      makePlayer('p8', 0),
    ];
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      reservationBlockThreshold: 2,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p1')).toBe(true);
  });

  it('未指定時はデフォルト閾値(2)が適用される', () => {
    const players = makePlayers();
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      // reservationBlockThreshold 未指定 → デフォルト 2
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p1')).toBe(false);
  });
});
