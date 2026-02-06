import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculatePlayerStats, getStreaks, buildInitialOrder, applyStreakSwaps, assignCourts } from './algorithm';
import type { Player } from '../types/player';
import type { Match } from '../types/match';

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

  it('二連勝で1つ上と交代', () => {
    // D が二連勝: matchHistoryは新しい順
    const matches = [
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 2試合目（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // D(index 3) が C(index 2) と交代
    expect(order).toEqual(['A', 'B', 'D', 'C', 'E', 'F']);
  });

  it('二連敗で1つ下と交代', () => {
    // D が二連敗
    const matches = [
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目（最新）
      createMatch(['W', 'V'], ['D', 'X'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // D(index 3) が E(index 4) と交代
    expect(order).toEqual(['A', 'B', 'C', 'E', 'D', 'F']);
  });

  it('三連勝でも二連勝分の1回だけ交代', () => {
    const matches = [
      createMatch(['D', 'X'], ['Y', 'Z'], 21, 15), // 3試合目（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 2試合目
      createMatch(['D', 'X'], ['U', 'T'], 21, 15), // 1試合目
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
    // 二連勝目でC→D交代、三連勝目はまだ4連勝目まで待つ
    expect(order).toEqual(['A', 'B', 'D', 'C', 'E', 'F']);
  });

  it('四連勝で2回交代（2つ上がる）', () => {
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
    // 二連勝目: D(3)とC(2)交代 → A,B,D,C,E,F
    // 四連勝目: D(2)とB(1)交代 → A,D,B,C,E,F
    expect(order).toEqual(['A', 'D', 'B', 'C', 'E', 'F']);
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

  it('最下位での二連敗は変化なし', () => {
    const matches = [
      createMatch(['Y', 'Z'], ['C', 'X'], 21, 15),
      createMatch(['W', 'V'], ['C', 'X'], 21, 15),
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C'],
      matches
    );
    // C は既に最下位（index 2）なので交代先がない
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('勝ち→負けで連勝リセット、交代は発生しない', () => {
    const matches = [
      createMatch(['Y', 'Z'], ['D', 'X'], 21, 15), // 2試合目: D負け（最新）
      createMatch(['D', 'X'], ['W', 'V'], 21, 15), // 1試合目: D勝ち
    ];
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      matches
    );
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

  it('ランダム固定時: レート上位4人がC1、下位4人がC2に配置される', () => {
    // Math.randomが一定値→確率差でupper全員がC1になる
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const assignments = assignCourts(make8Players(), 2, [], defaultOptions);

    const court1 = assignments.find(a => a.courtId === 1)!;
    const court2 = assignments.find(a => a.courtId === 2)!;

    const court1Players = [...court1.teamA, ...court1.teamB].sort();
    const court2Players = [...court2.teamA, ...court2.teamB].sort();

    expect(court1Players).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(court2Players).toEqual(['p5', 'p6', 'p7', 'p8']);
  });

  it('ランダム固定時: 連勝によるストリーク調整で配置が変わる', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // p5(rating 1200)が二連勝 → 序列が1つ上がり、p4と入れ替わる
    const matches = [
      createMatch(['p5', 'X'], ['Y', 'Z'], 21, 15),
      createMatch(['p5', 'X'], ['W', 'V'], 21, 15),
    ];

    const assignments = assignCourts(make8Players(), 2, matches, defaultOptions);

    const court1 = assignments.find(a => a.courtId === 1)!;
    const court1Players = [...court1.teamA, ...court1.teamB];

    expect(court1Players).toContain('p5');
    expect(court1Players).not.toContain('p4');
  });

  it('確率的にupper/lower間で行き来が発生する', () => {
    const players = make8Players();
    let pureUpperCount = 0;
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const assignments = assignCourts(players, 2, [], defaultOptions);
      const court1 = assignments.find(a => a.courtId === 1)!;
      const court1Players = new Set([...court1.teamA, ...court1.teamB]);

      // C1にupper全員（p1-p4）が揃う回数をカウント
      const allUpperOnC1 = ['p1', 'p2', 'p3', 'p4'].every(id => court1Players.has(id));
      if (allUpperOnC1) pureUpperCount++;
    }

    // 常に同じ配置ではない（ランダム性で行き来がある）
    expect(pureUpperCount).toBeGreaterThan(3);
    // 常にバラバラではない（upper傾向は維持される）
    expect(pureUpperCount).toBeLessThan(90);
  });

  it('15人の場合、優先度の高い8人が選ばれる', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

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
    // gamesPlayed=0の8人が優先
    for (let i = 1; i <= 8; i++) {
      expect(allAssigned).toContain(`p${i}`);
    }
    // gamesPlayed=5の7人は除外
    for (let i = 9; i <= 15; i++) {
      expect(allAssigned).not.toContain(`p${i}`);
    }
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
});
