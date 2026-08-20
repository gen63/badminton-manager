import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { calculatePlayerStats, getStreaks, buildInitialOrder, buildRanksWithTies, applyStreakSwaps, assignCourts, formTeams, sortWaitingPlayers, getCallableReservationRestingIds } from './algorithm';
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
    // 2連勝目: D(2)がstepSize=2つ上を狙うが、元の序列(3)から離れてよいのは
    // 1グループ分(stepSize=2)まで → index 1 で止まる（上位グループには入る）
    expect(order).toEqual(['A', 'D', 'B', 'C', 'E', 'F']);
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
    // 2連勝目: D(2)→上限(元の序列3 - stepSize2 = 1)まで → A,D,B,C,E,F
    // 3勝目: D(1)→上限に到達済みなので動かない
    expect(order).toEqual(['A', 'D', 'B', 'C', 'E', 'F']);
  });

  it('四連勝でも上限に達したらそれ以上は上がらない', () => {
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
    // 1勝+2連勝で上限（元の序列から1グループ分上）に到達、以降は変化なし
    expect(order).toEqual(['A', 'D', 'B', 'C', 'E', 'F']);
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

  it('連勝を重ねても元の序列から1グループ分より上には行かない', () => {
    // 9人3グループ（stepSize=3）。最下位 I が 6 連勝しても index 5 まで。
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
      Array.from({ length: 6 }, () => createMatch(['I', 'X'], ['Y', 'Z'], 21, 15))
    );
    expect(order.indexOf('I')).toBe(5); // 元の 8 から stepSize=3 上まで
    // 上位グループ（0-2）には侵入しない
    expect(order.slice(0, 3)).toEqual(['A', 'B', 'C']);
  });

  it('連敗を重ねても元の序列から1グループ分より下には行かない', () => {
    const order = applyStreakSwaps(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
      Array.from({ length: 6 }, () => createMatch(['Y', 'Z'], ['A', 'X'], 21, 15))
    );
    expect(order.indexOf('A')).toBe(3); // 元の 0 から stepSize=3 下まで
    // 下位グループ（6-8）には落ちない
    expect(order.slice(6)).toEqual(['G', 'H', 'I']);
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

describe('assignCourts - 実力差の分離', () => {
  /** 序列 rank 順（rating 降順）に人数分作る。gamesPlayed で優先度を作れる。 */
  const makeRoster = (count: number, fewerGames: number[]): Player[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      rating: 1000 - i,
      isResting: false,
      // 試合数が少ない = 優先度が高い（-Infinity にならないよう 1 以上にする）
      gamesPlayed: fewerGames.includes(i) ? 1 : 2,
      lastPlayedAt: 0,
      activatedAt: 0,
    }));

  it('人数が多いセッションでは、最上位と最下位が優先度で有利でも同じコートに入れない', () => {
    // 12人。最上位(p0)と最下位(p11)だけ試合数が少ない = 本来なら最優先で選ばれる
    const players = makeRoster(12, [0, 11]);
    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      allPlayers: players,
    });
    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(ids).toHaveLength(4);
    expect(ids.includes('p0') && ids.includes('p11')).toBe(false);
  });

  it('（旧エンジン）人数が少ないセッションでは実力差を考慮しない（優先度どおりに選ぶ）', () => {
    // 8人（MIN_ROSTER_FOR_SKILL_GAP 未満）。同じ条件でも両極端が選ばれる。
    //
    // 旧エンジン専用: MIN_ROSTER_FOR_SKILL_GAP(=12) 未満でソフトな実力差ペナルティ
    // (getSkillGapPenalty) 自体を無効化する、という旧エンジン固有のカットオフに
    // 依存している。新エンジンの skillGap 項は連続値でロースター人数に応じた
    // カットオフを持たないため、8人のような極小ロースターでは実力差の正規化幅
    // （分母 = rosterSize-1）が小さくなり、優先度（公平性）よりも実力差の均質化が
    // 優先されて p0×p7 が同居しないことがある（新エンジンには存在しない仕組み）。
    const players = makeRoster(8, [0, 7]);
    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      allPlayers: players,
      useObjectiveEngine: false,
    });
    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(ids.includes('p0') && ids.includes('p7')).toBe(true);
  });

  it('実力が近ければ優先度の高い人がそのまま選ばれる', () => {
    // 12人で、序列が隣接する 4 人だけ試合数が少ない → ペナルティ 0 で選ばれる
    const players = makeRoster(12, [4, 5, 6, 7]);
    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      allPlayers: players,
    });
    const ids = [...assignments[0].teamA, ...assignments[0].teamB].sort();
    expect(ids).toEqual(['p4', 'p5', 'p6', 'p7']);
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

  it('（旧エンジン）セッション状態（試合履歴）が変わるとランダム性のある配置が行われる', () => {
    // 旧エンジン専用: コート振り分けのノイズは試合履歴の長さ等から導出した
    // シード付き乱数という旧エンジン固有の仕組み。新エンジンは
    // `docs/plans/2026-08-05-pairing-goals-and-rewrite.md` の設計どおり
    // 「乱数なしで決定的」な局所探索なので、この乱数機構自体が存在しない。
    const players = make8Players();

    // コート振り分けのノイズは試合履歴の長さ等から導出したシード付き乱数になった
    // ため、matchHistory が同じままでは常に同じ結果になる（決定性は下のテストで
    // 確認）。ここではラウンドが進む＝試合履歴が伸びることでシードが変わり、
    // 上位/下位グループの行き来が起きることを確認する。
    const results = [];
    for (let i = 0; i < 5; i++) {
      const matches = Array.from({ length: i }, () =>
        createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15)
      );
      const assignments = assignCourts(players, 2, matches, { ...defaultOptions, useObjectiveEngine: false });
      const court1Players = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
      results.push([...court1Players].sort());
    }

    // 少なくとも1つは異なる結果があることを確認（状態依存のランダム性がある）
    const uniqueResults = new Set(results.map(r => r.join(',')));
    expect(uniqueResults.size).toBeGreaterThan(1);
  });

  it('同じ入力であれば assignCourts を複数回呼んでも必ず同じ結果になる（決定的シード）', () => {
    const players = make8Players();
    const matches = [
      createMatch(['p1', 'p2'], ['p3', 'p4'], 21, 15),
      createMatch(['p5', 'p6'], ['p7', 'p8'], 21, 18),
    ];

    const first = assignCourts(players, 2, matches, defaultOptions);
    for (let i = 0; i < 10; i++) {
      const assignments = assignCourts(players, 2, matches, defaultOptions);
      expect(assignments).toEqual(first);
    }
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

describe('assignCourts - 2コート同時配置の実力分離 (selectBestFour と同じペナルティ関数を使った分割)', () => {
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
    activatedAt: now - 60 * 60 * 1000,
  });

  // (B) 旧エンジン専用。新エンジンの目的3 は「順位差が ceil(人数 * 2/3) 以上」で
  // 定義されており、14人なら閾値は10。上位3人×下位3人でも順位差が9に収まる組
  // （rank2 × rank11 など）は目的3 の違反ではないため、**このテストの主張は
  // 新エンジンの目的定義より強い**。旧エンジンのバンド方式に固有の期待値。
  const defaultOptions = {
    totalCourtCount: 2,
    targetCourtIds: [1, 2],
    practiceStartTime: now - 60 * 60 * 1000,
    useObjectiveEngine: false,
  };

  it('14人（実力差ペナルティが効く人数）では、最上位3人と最下位3人が同じコートに入らない', () => {
    // 上位3人・下位3人は gamesPlayed=0 で最優先、中間8人は待たされている扱いに
    // して選出から漏れる余地を作らない（8人の必要人数のうち残り2枠を埋めるだけ）。
    const players: Player[] = [
      createRatedPlayer('top1', 'Top1', 2000, 0),
      createRatedPlayer('top2', 'Top2', 1900, 0),
      createRatedPlayer('top3', 'Top3', 1800, 0),
      createRatedPlayer('mid1', 'Mid1', 1700, 5),
      createRatedPlayer('mid2', 'Mid2', 1600, 5),
      createRatedPlayer('mid3', 'Mid3', 1500, 5),
      createRatedPlayer('mid4', 'Mid4', 1400, 5),
      createRatedPlayer('mid5', 'Mid5', 1300, 5),
      createRatedPlayer('mid6', 'Mid6', 1200, 5),
      createRatedPlayer('mid7', 'Mid7', 1100, 5),
      createRatedPlayer('mid8', 'Mid8', 1000, 5),
      createRatedPlayer('bottom1', 'Bottom1', 900, 0),
      createRatedPlayer('bottom2', 'Bottom2', 800, 0),
      createRatedPlayer('bottom3', 'Bottom3', 700, 0),
    ];
    const topIds = new Set(['top1', 'top2', 'top3']);
    const bottomIds = new Set(['bottom1', 'bottom2', 'bottom3']);

    // ラウンドを進めて（試合履歴を伸ばして）複数のノイズシードで確認する
    let history: Match[] = [];
    for (let round = 0; round < 15; round++) {
      const assignments = assignCourts(players, 2, history, defaultOptions);
      expect(assignments).toHaveLength(2);

      for (const a of assignments) {
        const ids = [...a.teamA, ...a.teamB];
        const hasTop = ids.some(id => topIds.has(id));
        const hasBottom = ids.some(id => bottomIds.has(id));
        expect(hasTop && hasBottom).toBe(false);
      }

      history = [
        ...history,
        ...assignments.map((a, i) => ({
          id: `r${round}-${i}`,
          courtId: a.courtId,
          teamA: a.teamA,
          teamB: a.teamB,
          scoreA: 21,
          scoreB: 15,
          startedAt: 0,
          finishedAt: 0,
          winner: 'A' as const,
        })),
      ];
    }
  });

  it('（旧エンジン）回転: 同じ実力帯の組が毎回同じ物理コートIDに固定されない', () => {
    // 旧エンジン専用: 「コートが固定化しない」（＝1人が使う物理コートの種類数）は
    // docs/plans/2026-08-05-pairing-goals-and-rewrite.md の6目的に含まれず、
    // 「目的外（ユーザー判断）」と明記されている。新エンジンは乱数なしの決定的な
    // 局所探索なので、同じ実力帯が同じ courtId に収束すること自体は目的関数上の
    // 問題ではない。
    const players: Player[] = [
      createRatedPlayer('top1', 'Top1', 2000, 0),
      createRatedPlayer('top2', 'Top2', 1900, 0),
      createRatedPlayer('top3', 'Top3', 1800, 0),
      createRatedPlayer('top4', 'Top4', 1700, 0),
      createRatedPlayer('bottom1', 'Bottom1', 900, 0),
      createRatedPlayer('bottom2', 'Bottom2', 800, 0),
      createRatedPlayer('bottom3', 'Bottom3', 700, 0),
      createRatedPlayer('bottom4', 'Bottom4', 600, 0),
    ];

    let history: Match[] = [];
    const topCourtIds = new Set<number>();
    for (let round = 0; round < 15; round++) {
      const assignments = assignCourts(players, 2, history, { ...defaultOptions, useObjectiveEngine: false });
      const topCourt = assignments.find(a => [...a.teamA, ...a.teamB].includes('top1'));
      if (topCourt) topCourtIds.add(topCourt.courtId);

      history = [
        ...history,
        ...assignments.map((a, i) => ({
          id: `r${round}-${i}`,
          courtId: a.courtId,
          teamA: a.teamA,
          teamB: a.teamB,
          scoreA: 21,
          scoreB: 15,
          startedAt: 0,
          finishedAt: 0,
          winner: 'A' as const,
        })),
      ];
    }

    // 上位グループが常に同じ物理コートIDに固定されていない
    // （固定されると「回転」＝1人が使うコート数の指標が落ちる）
    expect(topCourtIds.size).toBe(2);
  });

  it('12人未満では実力差の分割ロジックがあっても正しく2コート・8人に配置できる（少人数セッションの回帰確認）', () => {
    // MIN_ROSTER_FOR_SKILL_GAP(=12) 未満のロースターでは実力差ハード制約・
    // ペナルティが無効化される（getSkillGapPenalty / hasTopBottomExtremes と
    // 同じ閾値）。無効化されていても構造（2コート×4人）は壊れないことを確認する。
    const players = [
      createRatedPlayer('top1', 'Top1', 2000, 0),
      createRatedPlayer('top2', 'Top2', 1900, 0),
      createRatedPlayer('top3', 'Top3', 1800, 0),
      createRatedPlayer('mid1', 'Mid1', 1500, 0),
      createRatedPlayer('mid2', 'Mid2', 1400, 0),
      createRatedPlayer('bottom1', 'Bottom1', 900, 0),
      createRatedPlayer('bottom2', 'Bottom2', 800, 0),
      createRatedPlayer('bottom3', 'Bottom3', 700, 0),
    ];
    const assignments = assignCourts(players, 2, [], defaultOptions);
    expect(assignments).toHaveLength(2);
    assignments.forEach(a => {
      expect(a.teamA).toHaveLength(2);
      expect(a.teamB).toHaveLength(2);
    });
    const allAssigned = assignments.flatMap(a => [...a.teamA, ...a.teamB]);
    expect(new Set(allAssigned).size).toBe(8);
  });
});

describe('assignCourts - 2コート逐次配置（1コートずつ）の実力分離 (selectBestFour のハード制約)', () => {
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
    activatedAt: now - 60 * 60 * 1000,
  });

  // targetCourtIds を1コートだけにすることで、片方のコートしか空いていない
  // 「逐次配置」経路（selectBestFour を通る側）を通す。
  const sequentialOptions = {
    totalCourtCount: 2,
    targetCourtIds: [1],
    practiceStartTime: now - 60 * 60 * 1000,
  };

  it('16人: 優先度が高くても、順位差が閾値以上になる組み合わせは選ばれない', () => {
    // (A) 目的3（実力差のハード制約）そのものを検証する目的レベルのテスト。
    // 分類判断: このテストは書き換えていない（アサーションは目的3をそのまま表現している）。
    //
    // 【新エンジンの不具合を疑う】: 現状このテストは新エンジンで失敗する。
    // `assignRoundByObjective`（src/lib/pairing/assignRound.ts）の
    // wideSpanThreshold 制約つき初期解構築（171-209行目付近）で、
    // 制約を満たす4人を選ぶ `pool` は sortedCandidates 全員（＝ bench 候補も含む）
    // から貪欲に消費するのに対し、SearchState.bench は別途
    // `sortedCandidates.slice(neededCount)`（優先度上位から数えた末尾）という
    // 静的な計算のまま。両者が食い違うラウンドでは同一プレイヤーがコートと
    // bench の両方に現れ（重複）、別の1人が誰にも割り当てられず消える
    // （実測: このテストで [p0,p2,p7,p7] のように p7 が重複し p1 が消失する）。
    // 修復を試みず報告のみ（このテストファイル以外は変更しない指示のため）。
    // 16人なので閾値は ceil(16 * 2/3) = 11。
    // このラウンドの待機は p0,p1,p2,p7,p12 の5人だけ（他11人は別コートでプレイ中）。
    // 5人から4人を選ぶ組は5通りで、p12 を含むものは必ず順位差が11以上になり弾かれる。
    //   {p0,p1,p2,p7}=7 / {p0,p1,p2,p12}=12 / {p0,p1,p7,p12}=12
    //   {p0,p2,p7,p12}=12 / {p1,p2,p7,p12}=11
    // p12 だけ gamesPlayed=0（最優先）にしてあるので、制約が無ければ必ず選ばれる。
    // バンド方式（上位N人×下位N人だけ禁止）では p1×p12 のような「片方が端でない」
    // 組を弾けないため、このテストは順位差方式でしか通らない。
    const allPlayers: Player[] = Array.from({ length: 16 }, (_, i) =>
      createRatedPlayer(`p${i}`, `P${i}`, 2000 - i * 50, i === 12 ? 0 : 5)
    );
    const waitingIds = ['p0', 'p1', 'p2', 'p7', 'p12'];
    const waiting = allPlayers.filter(p => waitingIds.includes(p.id));

    const assignments = assignCourts(waiting, 1, [], {
      ...sequentialOptions,
      allPlayers,
    });

    expect(assignments).toHaveLength(1);
    const ids = [...assignments[0].teamA, ...assignments[0].teamB].sort();
    expect(ids, `順位差の制約を無視して p12 が選ばれた [${ids.join(', ')}]`)
      .toEqual(['p0', 'p1', 'p2', 'p7']);
  });

  it('（旧エンジン）11人（MIN_ROSTER_FOR_SKILL_GAP 未満）ではハード制約が効かず、上位と下位が同じコートに入り得る', () => {
    // 旧エンジン専用: MIN_ROSTER_FOR_SKILL_GAP(=12) 未満でソフトな実力差ペナルティ
    // 自体を丸ごと無効化する、という旧エンジン固有のカットオフに依存している。
    // 新エンジンの skillGap 項にはロースター人数によるカットオフが無く、
    // 11人のような極小ロースターでは正規化幅（分母 = rosterSize-1）が小さくなる
    // ぶん実力差の均質化が公平性より優先されうるため、top1×bottom1 の同居が
    // 崩れることがある（新エンジンには存在しない仕組み）。
    //
    // 上位1人・下位1人・中間2人だけを gamesPlayed=0（最優先）にして、他7人は
    // gamesPlayed=5 で優先度を大きく落とす。制約が無効なら、最優先の4人
    // （上位1人＋下位1人を含む）がそのまま選ばれるはず。
    const players: Player[] = [
      createRatedPlayer('top1', 'Top1', 2000, 0),
      createRatedPlayer('mid1', 'Mid1', 1500, 0),
      createRatedPlayer('mid2', 'Mid2', 1400, 0),
      createRatedPlayer('bottom1', 'Bottom1', 1000, 0),
      createRatedPlayer('mid3', 'Mid3', 1800, 5),
      createRatedPlayer('mid4', 'Mid4', 1700, 5),
      createRatedPlayer('mid5', 'Mid5', 1600, 5),
      createRatedPlayer('mid6', 'Mid6', 1300, 5),
      createRatedPlayer('mid7', 'Mid7', 1200, 5),
      createRatedPlayer('mid8', 'Mid8', 1100, 5),
      createRatedPlayer('mid9', 'Mid9', 900, 5),
    ];
    const assignments = assignCourts(players, 1, [], { ...sequentialOptions, useObjectiveEngine: false });
    expect(assignments).toHaveLength(1);
    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(ids).toContain('top1');
    expect(ids).toContain('bottom1');
  });

  it('ハード制約を満たす組が1つも無いときは例外にせず4人を選出する（フォールバック）', () => {
    // ロースター13人（band=2: 上位2人・下位2人がハード制約の対象）。このラウンドで
    // 実際に待機している候補は5人だけ（上位2人・下位2人・中間1人）で、他8人は
    // 別コートでプレイ中という想定（allPlayers には含めるが players には含めない）。
    // 5人中どの4人を選んでも上位・下位のどちらかが必ず残るため、上下同居を
    // 完全に避ける組み合わせは存在しない。
    const allPlayers: Player[] = Array.from({ length: 13 }, (_, i) =>
      createRatedPlayer(`p${i}`, `P${i}`, 2000 - i * 100, 0)
    );
    const waitingIds = ['p0', 'p1', 'p11', 'p12', 'p6'];
    const waitingPlayers = allPlayers.filter(p => waitingIds.includes(p.id));

    const assignments = assignCourts(waitingPlayers, 1, [], {
      ...sequentialOptions,
      allPlayers,
    });

    expect(assignments).toHaveLength(1);
    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    // 選ばれた4人は全員、待機していた5人プールの中から選ばれている
    ids.forEach(id => expect(waitingIds).toContain(id));
  });
});

describe('assignCourts - 3コート以上の逐次配置の実力分離 (hasTopBottomExtremes)', () => {
  // 優先度スコアは Date.now() と practiceStartTime の差（滞在時間）に依存するため、
  // 固定しないとテスト実行の実時間でラウンド途中の選出が変わりフレークする。
  const now = 10_000_000;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRatedPlayer = (id: string, rating: number): Player => ({
    id,
    name: id.toUpperCase(),
    gamesPlayed: 0,
    rating,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: now - 60 * 60 * 1000,
  });

  /**
   * 「弱いチームが必ず勝つ」ラウンドを回しながら、各試合が上位バンドと下位バンドを
   * 同居させていないことを検証する。
   *
   * 弱い側を勝たせるのは `applyStreakSwaps`（ハシゴ式）のドリフトを**双方向に最大化**
   * するため。上位者は連敗して沈み、下位者は連勝して上がるので、両者が中位グループで
   * 出会う。2026-08-04 の実セッションで起きたのがこれで、序列20位のメンバーが
   * 1・2・4位と同じコートに4回入った（`maxDrift = stepSize = 7` なので 18→11 と
   * 0→7 で中位グループに合流する）。
   *
   * ドリフト後の序列で判定する `hasIsolatedExtreme` は全員を「中位の人」として扱うため
   * この同居を検出できない。素の序列で見る `hasTopBottomExtremes` が3コート以上でも
   * 効いていないと、このテストは落ちる。
   *
   * 同居数の上限で判定するのは、`selectBestFour` の3段階フォールバックがあるため
   * 0 を保証できないから。候補が枯れたラウンドでは上下同居の制約だけが緩む（これは
   * 待機者を飛ばさないための設計）。現状は 150 試合中 2 件で、ガードを外すと 8 件になる。
   */
  const expectTopBottomMixAtMost = (
    players: Player[],
    topIds: Set<string>,
    bottomIds: Set<string>,
    rounds: number,
    maxViolations: number
  ): void => {
    const ratingById = new Map(players.map(p => [p.id, p.rating ?? 0]));
    const state = players.map(p => ({ ...p }));
    let history: Match[] = [];
    const violations: string[] = [];

    for (let round = 0; round < rounds; round++) {
      const assignments = assignCourts(state, 3, history, {
        totalCourtCount: 3,
        targetCourtIds: [1, 2, 3],
        practiceStartTime: now - 60 * 60 * 1000,
      });
      expect(assignments).toHaveLength(3);

      for (const a of assignments) {
        const ids = [...a.teamA, ...a.teamB];
        const hasTop = ids.some(id => topIds.has(id));
        const hasBottom = ids.some(id => bottomIds.has(id));
        if (hasTop && hasBottom) {
          violations.push(`round ${round}: [${ids.join(', ')}]`);
        }
      }

      const sum = (ids: readonly string[]) =>
        ids.reduce((s, id) => s + (ratingById.get(id) ?? 0), 0);

      history = [
        ...history,
        ...assignments.map((a, i) => ({
          id: `r${round}-${i}`,
          courtId: a.courtId,
          teamA: a.teamA,
          teamB: a.teamB,
          scoreA: 21,
          scoreB: 15,
          startedAt: 0,
          finishedAt: 0,
          // レート合計が低い（弱い）側を勝たせる
          winner: sum(a.teamA) < sum(a.teamB) ? ('A' as const) : ('B' as const),
        })),
      ];

      // production と同じく、出場者の試合数を進めて次ラウンドの優先度を動かす
      const played = new Set(assignments.flatMap(a => [...a.teamA, ...a.teamB]));
      for (const p of state) {
        if (played.has(p.id)) p.gamesPlayed += 1;
      }
    }

    // 失敗時にどのラウンドの誰が同居したか分かるようにメッセージへ含める
    expect(
      violations.length,
      `上位×下位の同居が ${violations.length} 件:\n${violations.join('\n')}`
    ).toBeLessThanOrEqual(maxViolations);
  };

  it('21人3コート: 登録序列の上位×下位でも、ハシゴ式で近づけば同居を許す', () => {
    // 21人なので WIDE_EXTREME_BAND_MIN_ROSTER(=18) 以上 → band=3。
    // p20（最下位）を毎回勝たせてハシゴ式で上位グループへ押し上げる。
    //
    // **方針変更（2026-08-18）**: 順位差のハード制約は登録レートの序列ではなく
    // ハシゴ式適用後の序列で判定するようになった。登録レートは「ハシゴ式の初期値を
    // 決めるためだけに使う」という方針に統一したため。
    //
    // その結果、このテストが数える「登録序列の上位3人 × 下位3人の同居」は
    // **意図的に許容される**。p20 を勝たせ続ければハシゴ式で上位帯まで上がるので、
    // ハシゴ式の序列では近い扱いになり制約を通る。以前は許容3件だったが 19 件に増える。
    //
    // 何を守るための緩和か: 登録レートが実力より高すぎて負け続ける人が、実力相応の
    // 帯まで降りられるようにするため。登録序列で安全網を張ると「本当に上位だが
    // 連敗中の人」と「そもそも上位ではない人」を区別できず、後者が救えない。
    // 振れ幅は `applyStreakSwaps` の maxDrift（±1グループ）が抑える。
    //
    // 代償の実測（SEEDS=60 NOISE=0、真の実力基準の幅広%）:
    //   16人2C 0.2% → 35.6% / 18人3C 0.9% → 31.2% / 21人3C 0.2% → 26.6%
    // 詳細: docs/plans/2026-08-05-pairing-goals-and-rewrite.md
    const players = Array.from({ length: 21 }, (_, i) =>
      createRatedPlayer(`p${i}`, 2000 - i * 50)
    );
    // **再緩和（skillGap 1.0 → 1.5）**: 22 件 → 30 件（実測 26 件）。
    // `skillGap` はハシゴ式**後**の序列を見るので、そちらの帯を締めるほど
    // **登録序列**基準の同居は増える。上の緩和（3 → 22）と全く同じトレードオフで、
    // 「登録序列で見た上位×下位」が悪化しているのではなく、ハシゴ式後の序列で
    // 見た帯がむしろ締まっている（幅広% は全条件で 1.3〜2.0pt 改善）。
    // このテストは登録序列基準なので、その改善が逆符号で出る。
    //
    // 50ラウンド=150試合。ハシゴ式そのものを外すと 8 件まで下がる
    expectTopBottomMixAtMost(
      players,
      new Set(['p0', 'p1', 'p2']),
      new Set(['p18', 'p19', 'p20']),
      50,
      30
    );
  });

  it('15人3コート（待機3人）ではフォールバックが働き、上下同居を許してでも3コート配置を続ける', () => {
    // (A) 目的3（実力差のハード制約）が「候補が枯れても例外にせず配置を続ける」
    // という目的レベルの要求を検証するテスト。分類判断: 書き換えていない。
    //
    // 【新エンジンの不具合を疑う】: 現状このテストは新エンジンで失敗する
    // （15コート12人配置のはずが `new Set(ids).size` が 12 でなく 11 になる＝
    // 誰か1人が重複し、別の1人が消える）。原因は上の「16人」テストで報告した
    // `assignRoundByObjective` の pool/bench 不整合バグと同一で、3コートの
    // wideSpanThreshold 制約つき初期解構築でも同様に再現する（実測で確認済み、
    // 例: 15人3コートのあるラウンドで p3/p5 の一方が重複し、他の1人が消失）。
    // 修復を試みず報告のみ。
    //
    // 12人が同時に出場するため待機は3人しかなく、上下同居を完全に避ける組み合わせが
    // 存在しないラウンドが出る。そのとき `selectBestFour` の3段階フォールバックが
    // 上下同居の制約だけを緩めるので、例外にならず配置は続く（待機者を飛ばさない）。
    // ハード制約が「候補が枯れたら緩む」設計であることを固定するテスト。
    const players = Array.from({ length: 15 }, (_, i) =>
      createRatedPlayer(`p${i}`, 2000 - i * 50)
    );
    const state = players.map(p => ({ ...p }));
    let history: Match[] = [];

    for (let round = 0; round < 15; round++) {
      const assignments = assignCourts(state, 3, history, {
        totalCourtCount: 3,
        targetCourtIds: [1, 2, 3],
        practiceStartTime: now - 60 * 60 * 1000,
      });
      // 例外を投げず、毎ラウンド3コート12人を配置しきる
      expect(assignments).toHaveLength(3);
      const ids = assignments.flatMap(a => [...a.teamA, ...a.teamB]);
      expect(new Set(ids).size).toBe(12);

      history = [
        ...history,
        ...assignments.map((a, i) => ({
          id: `r${round}-${i}`,
          courtId: a.courtId,
          teamA: a.teamA,
          teamB: a.teamB,
          scoreA: 21,
          scoreB: 15,
          startedAt: 0,
          finishedAt: 0,
          winner: 'A' as const,
        })),
      ];
      const played = new Set(ids);
      for (const p of state) {
        if (played.has(p.id)) p.gamesPlayed += 1;
      }
    }
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

describe('formTeams - パートナー/対戦相手の多様性（matchHistory）', () => {
  const createPlayer = (id: string, name: string, rating: number): Player => ({
    id, name, rating, gamesPlayed: 0, isResting: false, lastPlayedAt: 0, activatedAt: 0,
  });

  const createMatch = (teamA: [string, string], teamB: [string, string]): Match => ({
    id: `match-${teamA.join('')}-${teamB.join('')}`,
    courtId: 1,
    teamA,
    teamB,
    scoreA: 21,
    scoreB: 15,
    winner: 'A',
    startedAt: 0,
    finishedAt: 0,
  });

  it('matchHistory省略時は従来通り1+4 vs 2+3を返す', () => {
    const players = [
      createPlayer('p1', 'P1', 2000),
      createPlayer('p2', 'P2', 1800),
      createPlayer('p3', 'P3', 1600),
      createPlayer('p4', 'P4', 1400),
    ];
    const order = ['p1', 'p2', 'p3', 'p4'];
    // 過去に p1+p4 vs p2+p3 を何度繰り返していても、matchHistory を渡さなければ
    // 多様性ロジックは働かない（従来の呼び出し元との後方互換のため）
    const result = formTeams(players, order);
    expect(result.teamA).toEqual(['p1', 'p4']);
    expect(result.teamB).toEqual(['p2', 'p3']);
  });

  it('序列に十分な余裕があれば、バランスを保ちつつ過去に組んだ回数が少ないペア分けを選ぶ', () => {
    const players = [
      createPlayer('p1', 'P1', 2000),
      createPlayer('p2', 'P2', 1800),
      createPlayer('p3', 'P3', 1600),
      createPlayer('p4', 'P4', 1400),
    ];
    // playerOrder を12人分にしておくとバランス許容幅（人数/3=4）が広がり、
    // 1+3 vs 2+4（バランス悪化幅2）も選択肢に入る
    const order = ['p1', 'p2', 'p3', 'p4', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'];
    // デフォルト（p1+p4 vs p2+p3）を過去に3回繰り返し済み
    const matchHistory: Match[] = [
      createMatch(['p1', 'p4'], ['p2', 'p3']),
      createMatch(['p1', 'p4'], ['p2', 'p3']),
      createMatch(['p1', 'p4'], ['p2', 'p3']),
    ];
    const result = formTeams(players, order, matchHistory);

    // 1+3 vs 2+4（p1+p3 vs p2+p4）は過去に一度も組んでいないため、そちらを選ぶ
    expect(result.teamA).toEqual(['p1', 'p3']);
    expect(result.teamB).toEqual(['p2', 'p4']);
  });

  it('序列に余裕が無い（4人だけ）場合は、履歴が偏っていてもバランスを崩さずデフォルトのまま', () => {
    const players = [
      createPlayer('p1', 'P1', 2000),
      createPlayer('p2', 'P2', 1800),
      createPlayer('p3', 'P3', 1600),
      createPlayer('p4', 'P4', 1400),
    ];
    // playerOrder が4人のみ → 許容幅 floor(4/3)=1 で、1+3 vs 2+4（悪化幅2）は
    // 許容範囲を超えるため選べない
    const order = ['p1', 'p2', 'p3', 'p4'];
    const matchHistory: Match[] = [
      createMatch(['p1', 'p4'], ['p2', 'p3']),
      createMatch(['p1', 'p4'], ['p2', 'p3']),
      createMatch(['p1', 'p4'], ['p2', 'p3']),
    ];
    const result = formTeams(players, order, matchHistory);

    // バランス優先でデフォルトのまま
    expect(result.teamA).toEqual(['p1', 'p4']);
    expect(result.teamB).toEqual(['p2', 'p3']);
  });
});

describe('assignCourts - パートナー/対戦相手重複ペナルティ（selectBestFour）', () => {
  const createPlayer = (id: string, rating: number): Player => ({
    id, name: id, rating, gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0,
  });

  it('優先度が同点でも、直近試合と3人以上かぶらず、未共演の人が優先される', () => {
    // (A) 目的6（顔ぶれが繰り返されない）を検証する。
    //
    // 旧実装は「{p0,p2,p4,p5} がちょうど選ばれる」と完全一致で固定していたが、
    // それは旧エンジンの重み配分（パートナー重複 0.1 > 対戦相手重複 0.05 なので
    // 対戦相手だった p0-p2 を含む組を好む）という**手段の詳細**に依存していた。
    // 目的そのもの ——「直近試合の再演を避け、未共演の人を使う」—— を assert する。
    //
    // 6人（p0>p1>...>p5）。全員 gamesPlayed=1 で優先度は同点。
    // 過去に p0+p1 vs p2+p3 の1試合だけがあり、p4/p5 は未プレイ。
    const players = [0, 1, 2, 3, 4, 5].map((i) => createPlayer(`p${i}`, 1000 - i));
    const matchHistory: Match[] = [{
      id: 'm1', courtId: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'],
      scoreA: 21, scoreB: 15, winner: 'A', startedAt: 0, finishedAt: 0,
    }];

    const assignments = assignCourts(players, 1, matchHistory, {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      allPlayers: players,
    });

    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);

    // 直近試合の4人と3人以上かぶらない（＝同じ顔ぶれの再演にならない）
    const overlap = ids.filter(id => ['p0', 'p1', 'p2', 'p3'].includes(id)).length;
    expect(overlap, `直近試合と ${overlap} 人かぶっている [${ids.join(', ')}]`)
      .toBeLessThanOrEqual(2);

    // 誰とも共演していない p4 / p5 が使われる
    expect(ids).toContain('p4');
    expect(ids).toContain('p5');
  });
});

describe('assignCourts - 特定の1人への偏りのペナルティ（集中度）', () => {
  const NOW = 10_000_000;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createPlayer = (id: string, rating: number): Player => ({
    id,
    name: id,
    rating,
    gamesPlayed: 6,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * 60 * 1000,
  });

  it('目的関数（目的6・顔ぶれ）は突出して多く組んだペアを、分散したペアより避ける', () => {
    // 新エンジンの variety 項（`computeVariety`）は「最多ペアの共演回数」を
    // 直接見るため、合計が同程度でも集中度が違えば区別できる（目的6の本来の狙い）。
    //
    // 待機9人（p0〜p8）から4人を選ぶ。履歴は:
    //   - p0-p1 が6回パートナー（集中。最多ペア=6回）
    //   - p2/p3/p4 は互いに2回ずつ（分散。合計は同程度だが最多ペア=2回）
    // p5〜p8 は控えの選択肢を広げるための同条件プレイヤー（本番同様、待機列には
    // 通常複数の交換候補がいる）。
    const allPlayers = Array.from({ length: 12 }, (_, i) =>
      createPlayer(`p${i}`, 1500 - i * 2)
    );
    const waitingIds = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const waiting = allPlayers.filter(p => waitingIds.includes(p.id));

    const history: Match[] = [];
    const add = (teamA: [string, string], teamB: [string, string]): void => {
      history.push({
        id: `h${history.length}`,
        courtId: 1,
        teamA,
        teamB,
        scoreA: 21,
        scoreB: 15,
        winner: 'A',
        startedAt: 0,
        finishedAt: 0,
      });
    };
    // 対戦相手は毎回変えて、対戦相手側の重複が効かないようにする
    const outsiders: [string, string][] = [
      ['p9', 'p10'], ['p11', 'p9'], ['p10', 'p11'],
      ['p9', 'p10'], ['p11', 'p9'], ['p10', 'p11'],
    ];
    for (const opp of outsiders) add(['p0', 'p1'], opp);
    for (const pair of [['p2', 'p3'], ['p2', 'p4'], ['p3', 'p4']] as [string, string][]) {
      for (const opp of [['p5', 'p7'], ['p9', 'p11']] as [string, string][]) add(pair, opp);
    }

    const assignments = assignCourts(waiting, 1, history, {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      allPlayers,
    });

    expect(assignments).toHaveLength(1);
    const ids = [...assignments[0].teamA, ...assignments[0].teamB];
    // 6回組んだ p0 と p1 が再び同じコートに入らない
    expect(
      ids.includes('p0') && ids.includes('p1'),
      `6回組んだ p0-p1 が再選出された [${ids.join(', ')}]`
    ).toBe(false);
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
    // 候補5人: M1, M2, M3, F1, F2 （全員ほぼ同じ優先度・僅差のレーティング）。
    // ロースター全体（allPlayers）には他に15人の控えを加えて、実力差の正規化幅
    // （denom = rosterSize-1）が極小ロースターで不自然に拡大しないようにする
    // （本番のセッションも通常このくらいの規模がある）。
    const players = [
      createGenderedPlayer('m1', 'M1', 1500, 'M'),
      createGenderedPlayer('m2', 'M2', 1499, 'M'),
      createGenderedPlayer('m3', 'M3', 1498, 'M'),
      createGenderedPlayer('f1', 'F1', 1497, 'F'),
      createGenderedPlayer('f2', 'F2', 1496, 'F'),
    ];
    const fillers = Array.from({ length: 15 }, (_, i) =>
      createGenderedPlayer(`x${i}`, `X${i}`, 1600 + i * 5, i % 2 === 0 ? 'M' : 'F', 50)
    );
    const allPlayers = [...players, ...fillers];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
      allPlayers,
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

describe('assignCourts - 少数派性別1人のときの3-1ペナルティ無効化', () => {
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

  it('少数派が1人のセッションでは3-1ペナルティが効かない（優先度どおり最も待っている女性が配置される）', () => {
    // p1-p4: 男性 gp=10、p5: 女性 gp=8（最も待っている）。
    // セッション全体（options.allPlayers省略時はplayers全員）で女性は p5 の1人だけ
    // → 2-2は物理的に作れない構成。修正前は 3-1 ペナルティ(+3.0)が常に勝ち、
    //   p5 は 4-0 (16.0) より不利な 3-1 (15.2+3.0=18.2) として弾かれ続けていた。
    // 修正後はペナルティが無効化され、素直に優先度（待ち時間）順で p5 が選ばれる。
    const players: Player[] = [
      createGenderedPlayer('p1', 'P1', 1500, 'M', 10),
      createGenderedPlayer('p2', 'P2', 1500, 'M', 10),
      createGenderedPlayer('p3', 'P3', 1500, 'M', 10),
      createGenderedPlayer('p4', 'P4', 1500, 'M', 10),
      createGenderedPlayer('p5', 'P5', 1500, 'F', 8),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p5')).toBe(true);
  });

  it('バランスが取れる構成（少数派が全体で2人以上）では今回の候補が女性1人でも従来どおり3-1を避ける', () => {
    // players（今回の配置候補）は p1-p4(M) + p5(F) の5人だが、
    // options.allPlayers（セッション全体、他コートでプレイ中の p6(F) を含む）では
    // 女性が2人いる = 2-2が作れる可能性がある「バランスが取れる構成」。
    // このときは genderPairImpossible が false のまま維持され、
    // 従来どおり 3-1 ペナルティが有効 → 単独では待っていても p5 は選ばれない。
    const players: Player[] = [
      createGenderedPlayer('p1', 'P1', 1500, 'M', 10),
      createGenderedPlayer('p2', 'P2', 1500, 'M', 10),
      createGenderedPlayer('p3', 'P3', 1500, 'M', 10),
      createGenderedPlayer('p4', 'P4', 1500, 'M', 10),
      createGenderedPlayer('p5', 'P5', 1500, 'F', 8),
    ];
    const allPlayers: Player[] = [
      ...players,
      createGenderedPlayer('p6', 'P6', 1500, 'F', 10), // 他コートでプレイ中の女性
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
      allPlayers,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('p5')).toBe(false);
  });
});

describe('assignCourts - 少数派性別が少ないときのMIX優遇 (preferGenderMix)', () => {
  const now = Date.now();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createGenderedPlayer = (
    id: string, gender: 'M' | 'F', gamesPlayed: number
  ): Player => ({
    id, name: id, rating: 1500, gender, gamesPlayed,
    isResting: false, lastPlayedAt: 0,
    activatedAt: now - 60 * 60 * 1000,
  });

  it('少数派が少ないセッション（30%未満）ではMIX（2-2）が同性（4-0）より優先される', () => {
    // 5M+2F=7人（少数派比率 2/7≈28.6% < 30% → preferGenderMix）。
    // useStayDurationPriority: false なので oneGameDelta=1.0、優先度スコアは
    // gamesPlayed * 0.4（GAMES_PLAYED_SCORE_UNIT）。
    // 最良の4-0（m1,m2,m3 + m4かm5）: 0.4+0.4+0.8+1.2 = 2.8
    // 最良のMIX（m1,m2,f1,f2）    : 0.4+0.4+0.8+0.8 = 2.4
    // 差は 0.4 で GENDER_MIX_PENALTY(0.5) より小さいため、
    // 修正前（MIXに常に+0.5）なら 2.4+0.5=2.9 > 2.8 で4-0が勝つが、
    // 修正後（少数派が少ないときはMIXペナルティ0）なら 2.4 < 2.8 でMIXが勝つ。
    const players: Player[] = [
      createGenderedPlayer('m1', 'M', 1),
      createGenderedPlayer('m2', 'M', 1),
      createGenderedPlayer('m3', 'M', 2),
      createGenderedPlayer('m4', 'M', 3),
      createGenderedPlayer('m5', 'M', 3),
      createGenderedPlayer('f1', 'F', 2),
      createGenderedPlayer('f2', 'F', 2),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('f1')).toBe(true);
    expect(picked.has('f2')).toBe(true);
  });

  it('（旧エンジン）男女が拮抗したセッション（30%以上）では従来どおり同性（4-0）がMIXより優先される', () => {
    // 旧エンジン専用: 「非少数派希薄時は 4-0 を 2-2(MIX) より積極的に優先する」という
    // 固定加点（GENDER_MIX_PENALTY）は旧エンジン固有の設計。新エンジンの
    // `computeGender` は preferGenderMix=false のとき 4-0 と 2-2 を同値（0）で扱う
    // （3-1 だけを避ければよく、4-0 と 2-2 のどちらを選ぶかは目的5にとって
    // 中立）。そのため新エンジンでは優先度（公平性）どおり最も待っている
    // f1/f2 を含む2-2が選ばれてよく、これは目的関数上は劣化ではない
    // （新エンジンには存在しない「4-0 を積極優先する」仕組みへの依存）。
    //
    // 4M+2F=6人（少数派比率 2/6≈33.3% ≥ 30% → preferGenderMix にはならない）。
    // 最良の4-0（m1,m2,m3,m4）: 0.4+0.4+0.8+1.2 = 2.8
    // 最良のMIX（m1,m2,f1,f2）: 0.4+0.4+0.8+0.8+0.5(GENDER_MIX_PENALTY) = 2.9
    // 2.8 < 2.9 なので、男女比が拮抗している場合は修正前と変わらず4-0が勝つ
    // （3-1 は shouldAllowUnbalancedGender が false になりハード制約で弾かれる）。
    const players: Player[] = [
      createGenderedPlayer('m1', 'M', 1),
      createGenderedPlayer('m2', 'M', 1),
      createGenderedPlayer('m3', 'M', 2),
      createGenderedPlayer('m4', 'M', 3),
      createGenderedPlayer('f1', 'F', 2),
      createGenderedPlayer('f2', 'F', 2),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
      useObjectiveEngine: false,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('f1')).toBe(false);
    expect(picked.has('f2')).toBe(false);
    expect(picked.has('m1')).toBe(true);
    expect(picked.has('m2')).toBe(true);
    expect(picked.has('m3')).toBe(true);
    expect(picked.has('m4')).toBe(true);
  });
});

describe('assignCourts - ラウンド単位への一般化 (改善1: roundGenderPairImpossible)', () => {
  const now = Date.now();

  const mk = (id: string, gender: 'M' | 'F', rating: number, gamesPlayed: number): Player => ({
    id, name: id, rating, gender, gamesPlayed,
    isResting: false, lastPlayedAt: 0, activatedAt: now - 60 * 60 * 1000,
  });

  it('（旧エンジン）先のコートで少数派の片方が使われ、このラウンドの残りに少数派が1人だけになったコートでは、3-1ペナルティが弱まり自分のレーティング帯内で選ばれる', () => {
    // 旧エンジン専用: `groupPlayers3Court` による upper/middle/lower 帯分割と
    // `selectMostUrgentGroup`、および帯の中で少数派が1人だけになったときだけ
    // 3-1ペナルティを弱める `roundGenderPairImpossible` は、いずれも旧エンジン
    // （selectBestFour 系の逐次配置）固有の仕組み。新エンジンはコート間の帯分割を
    // 行わず全コートを同時に目的関数で最適化するため、この仕組み自体が存在しない。
    //
    // 15人3コート（groupPlayers3Courtで upper/middle/lower が5人ずつに等分される）。
    // 少数派(F)は2人（f1がupper、f2がlower）で、全体比 2/15≈13.3% < 30%
    // → preferGenderMix=true、genderPairImpossible=false（少数派2人なのでセッション
    //   全体では2-2を作れる余地がある）。
    // upper: f1(gp=0、初回保証で必ず選ばれる) + mu1-4(gp=15)。
    //   → court1はupperが最優先で選ばれ、f1を含む4人が確定する
    //     （f1が使われるので、このラウンドの残り少数派はf2の1人だけになる）。
    // middle: mm1-5(gp=20、平均試合数から外れ selectMostUrgentGroup の対象から
    //   ほぼ外れる) → 最後に処理される。
    // lower: f2(gp=5) + ml1-4(gp=10)。5人から4人を選ぶ実質的な選択がある。
    //   セッション全体でみると genderPairImpossible=false なので、素の3-1ペナルティ
    //   (3.0)なら「ml1-4の4-0」(合計16.0)が「f2+ml3人の3-1」(合計 2.0+12.0+3.0=17.0)
    //   より優先されf2は外れるはずだが、この時点でf1は既に使用済みで少数派は
    //   f2だけ → roundGenderPairImpossible=trueとなり弱めたペナルティ(3.0*0.35=1.05)
    //   が適用され、f2を含む組(2.0+12.0+1.05=15.05)が4-0(16.0)より優先される。
    const players: Player[] = [
      mk('f1', 'F', 2000, 0),
      mk('mu1', 'M', 1950, 15), mk('mu2', 'M', 1900, 15), mk('mu3', 'M', 1850, 15), mk('mu4', 'M', 1800, 15),
      mk('mm1', 'M', 1500, 20), mk('mm2', 'M', 1450, 20), mk('mm3', 'M', 1400, 20), mk('mm4', 'M', 1350, 20), mk('mm5', 'M', 1300, 20),
      mk('f2', 'F', 1000, 5),
      mk('ml1', 'M', 950, 10), mk('ml2', 'M', 900, 10), mk('ml3', 'M', 850, 10), mk('ml4', 'M', 800, 10),
    ];

    const assignments = assignCourts(players, 3, [], {
      totalCourtCount: 3,
      targetCourtIds: [1, 2, 3],
      practiceStartTime: now - 60 * 60 * 1000,
      useStayDurationPriority: false,
      useObjectiveEngine: false,
    });

    // f1 は upper グループ内（mu1-4）だけで組まれる
    const f1Court = assignments.find(a => [...a.teamA, ...a.teamB].includes('f1'));
    expect(f1Court).toBeDefined();
    const f1Mates = [...f1Court!.teamA, ...f1Court!.teamB].filter(id => id !== 'f1');
    expect(f1Mates.every(id => id.startsWith('mu'))).toBe(true);

    // f2 は待たされて mm(middle) グループに紛れ込むのではなく、
    // 自分のレーティング帯である lower グループ（ml1-4）内で選ばれる
    const f2Court = assignments.find(a => [...a.teamA, ...a.teamB].includes('f2'));
    expect(f2Court).toBeDefined();
    const f2Mates = [...f2Court!.teamA, ...f2Court!.teamB].filter(id => id !== 'f2');
    expect(f2Mates.every(id => id.startsWith('ml'))).toBe(true);
  });
});

describe('assignCourts - 2コート同時配置の少数派2-2修復 (改善2: repairScatteredMinorityPair2Court)', () => {
  // 12人2コート・少数派2人のシミュレーションで実際に発生した局面をそのまま
  // 固定値として採用したテストケース。assign2CourtsHolistic は選出直後に
  // 少数派2人を同じコートへ強制的にまとめるが、その後に呼ぶ
  // tryFixRecentMatch（直近試合の重複回避のためのコート間スワップ）が
  // 性別を考慮せず1人単位でスワップするため、まとめた2-2を1-1（3-1が2つ）に
  // 崩してしまうことがある。repairScatteredMinorityPair2Court はこれを
  // tryFixRecentMatch の後に検知し、直近試合制約・実力差を悪化させない
  // 範囲で2-2に戻す。

  it('tryFixRecentMatchで2-2が1-1に崩れても、直近試合制約と実力差を悪化させない入れ替えがあれば2-2に修復される', () => {
    const players: Player[] = [
      { id: 'p0', name: 'P0', rating: 1000, gender: 'F', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p1', name: 'P1', rating: 999, gender: 'M', gamesPlayed: 2, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p2', name: 'P2', rating: 998, gender: 'M', gamesPlayed: 2, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p3', name: 'P3', rating: 997, gender: 'M', gamesPlayed: 2, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p4', name: 'P4', rating: 996, gender: 'F', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p5', name: 'P5', rating: 995, gender: 'M', gamesPlayed: 2, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p6', name: 'P6', rating: 994, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p7', name: 'P7', rating: 993, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p8', name: 'P8', rating: 992, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p9', name: 'P9', rating: 991, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p10', name: 'P10', rating: 990, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p11', name: 'P11', rating: 989, gender: 'M', gamesPlayed: 1, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
    ];
    const history: Match[] = [
      { id: 'm0', courtId: 1, teamA: ['p0', 'p2'], teamB: ['p1', 'p4'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm1', courtId: 2, teamA: ['p3', 'p7'], teamB: ['p5', 'p6'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm2', courtId: 1, teamA: ['p1', 'p8'], teamB: ['p5', 'p3'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm3', courtId: 2, teamA: ['p2', 'p11'], teamB: ['p9', 'p10'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
    ];

    vi.spyOn(Date, 'now').mockReturnValue(2220000);
    const assignments = assignCourts(players, 2, history, {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: 0,
      useStayDurationPriority: true,
      allPlayers: players,
    });

    // 修復前（tryFixRecentMatchのみ）は各コートに少数派(p0,p4)が1人ずつ散り、
    // 2つとも3-1になっていた。修復後は2-2 + 4-0になっているはず。
    const genderCounts = assignments.map(a => {
      const ids = [...a.teamA, ...a.teamB];
      return ids.filter(id => id === 'p0' || id === 'p4').length;
    });
    expect(genderCounts.sort()).toEqual([0, 2]);
  });

  it('ロースター12人では順位差のハード制約が無く、少数派2-2への修復が成立する', () => {
    const players: Player[] = [
      { id: 'p0', name: 'P0', rating: 1000, gender: 'M', gamesPlayed: 7, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p1', name: 'P1', rating: 999, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p2', name: 'P2', rating: 998, gender: 'F', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p3', name: 'P3', rating: 997, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p4', name: 'P4', rating: 996, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p5', name: 'P5', rating: 995, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p6', name: 'P6', rating: 994, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p7', name: 'P7', rating: 993, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p8', name: 'P8', rating: 992, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p9', name: 'P9', rating: 991, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p10', name: 'P10', rating: 990, gender: 'F', gamesPlayed: 5, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
      { id: 'p11', name: 'P11', rating: 989, gender: 'M', gamesPlayed: 6, isResting: false, lastPlayedAt: 0, activatedAt: 0 },
    ];
    const history: Match[] = [
      { id: 'm0', courtId: 1, teamA: ['p1', 'p6'], teamB: ['p4', 'p5'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm1', courtId: 2, teamA: ['p0', 'p7'], teamB: ['p2', 'p3'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm2', courtId: 1, teamA: ['p0', 'p10'], teamB: ['p1', 'p2'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm3', courtId: 2, teamA: ['p8', 'p11'], teamB: ['p9', 'p3'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm4', courtId: 1, teamA: ['p0', 'p9'], teamB: ['p5', 'p7'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm5', courtId: 2, teamA: ['p4', 'p11'], teamB: ['p6', 'p8'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm6', courtId: 1, teamA: ['p4', 'p10'], teamB: ['p2', 'p5'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm7', courtId: 2, teamA: ['p1', 'p6'], teamB: ['p3', 'p7'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm8', courtId: 1, teamA: ['p1', 'p10'], teamB: ['p0', 'p2'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm9', courtId: 2, teamA: ['p9', 'p8'], teamB: ['p3', 'p11'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm10', courtId: 1, teamA: ['p4', 'p8'], teamB: ['p0', 'p7'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm11', courtId: 2, teamA: ['p9', 'p11'], teamB: ['p6', 'p5'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm12', courtId: 1, teamA: ['p6', 'p2'], teamB: ['p10', 'p7'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm13', courtId: 2, teamA: ['p1', 'p3'], teamB: ['p4', 'p5'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm14', courtId: 1, teamA: ['p1', 'p2'], teamB: ['p0', 'p10'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm15', courtId: 2, teamA: ['p9', 'p11'], teamB: ['p3', 'p8'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
      { id: 'm16', courtId: 1, teamA: ['p0', 'p4'], teamB: ['p6', 'p9'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'B' },
      { id: 'm17', courtId: 2, teamA: ['p7', 'p8'], teamB: ['p11', 'p5'], scoreA: 21, scoreB: 15, startedAt: 0, finishedAt: 0, winner: 'A' },
    ];

    vi.spyOn(Date, 'now').mockReturnValue(7260000);
    const assignments = assignCourts(players, 2, history, {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: 0,
      useStayDurationPriority: true,
      allPlayers: players,
    });

    // 少数派(p2,p10)が同じコートに集まる（2-2 が作れる）。
    //
    // 以前は実力差のハード制約（バンド方式、12人でも適用）が入れ替えを阻んで
    // 1-1 のままだったが、目的3 のハード制約は `WIDE_RANK_SPAN_MIN_ROSTER`(14) 未満の
    // 少人数には掛からなくなったため、修復が通るようになった。
    // bench でも 12人2コートの 3-1 率は 11.4% → 4.6% に改善している
    // （docs/plans/2026-08-05-pairing-goals-and-rewrite.md）。
    const genderCounts = assignments.map(a => {
      const ids = [...a.teamA, ...a.teamB];
      return ids.filter(id => id === 'p2' || id === 'p10').length;
    });
    expect(genderCounts.sort()).toEqual([0, 2]);
  });
});

describe('assignCourts - 3コート以上の性別3-1をベンチ入れ替えで解消する (repairGenderParityWithBench)', () => {
  // 男女がおおむね半々（少数派30%以上）の3コートセッションで、各コートが
  // 自分のレーティング帯からしか選ばれないため、upperグループ4人が
  // ちょうど3M1Fで固定され（選択の余地なし）3-1になるケース。
  // upper(3M1F)とmiddle(2M2F)・lower(4M0F)のどちらの間でも、コート間の
  // 人数（M人数の合計）が奇数になるため repairCourtConstraints の
  // コート間スワップだけでは解消できない（数学的に不可能）。
  // 待機列（このラウンドで選ばれなかった人）に F がいれば、
  // repairGenderParityWithBench がベンチ入れ替えで解消する。
  const mk = (id: string, gender: 'M' | 'F', rating: number, gamesPlayed: number): Player => ({
    id, name: id, rating, gender, gamesPlayed,
    isResting: false, lastPlayedAt: 0, activatedAt: 0,
  });

  it('（旧エンジン）待機列に2人以上いれば、コート間スワップで解消できない性別3-1を待機列との入れ替えで解消する', () => {
    // 旧エンジン専用: `groupPlayers3Court` の upper/middle/lower 帯分割で
    // コートごとの候補が固定されてしまう構造と、それを修復する
    // `repairGenderParityWithBench`（待機列との性別スワップ）は、いずれも旧エンジン
    // 固有の修復パス。新エンジンは全コートを同時に最適化するため帯固定も
    // 修復パスも存在しない。
    //
    // 14人（F5人、35.7%≥30% → preferGenderMix=false）。
    // upper: mu1,mu2,mu3(M) + f1(F) → 4人固定、選択の余地なく3M1Fで確定。
    // middle: mm1,mm2(M) + f2,f3,f4,f5(F) の6人から4人選出。
    //   優先度(gamesPlayed*0.4)が最小になるのは mm1,mm2,f2,f3（合計1.6+MIX0.5=2.1）
    //   で、f4,f5(gamesPlayed=5)は待機に回る。
    // lower: ml1-4(M) → 4人固定、4M0F。
    // → upperの3-1は、middle/lowerいずれとの間でもM人数の合計が奇数
    //   （3+2=5, 3+4=7）になり、コート間スワップだけでは解消不可能。
    // 待機列の f4/f5（F）とベンチ入れ替えることで解消できるはず。
    const players: Player[] = [
      mk('mu1', 'M', 2000, 5), mk('mu2', 'M', 1990, 5), mk('mu3', 'M', 1980, 5), mk('f1', 'F', 1970, 5),
      mk('mm1', 'M', 1900, 1), mk('mm2', 'M', 1890, 1), mk('f2', 'F', 1880, 1), mk('f3', 'F', 1870, 1),
      mk('f4', 'F', 1860, 5), mk('f5', 'F', 1850, 5),
      mk('ml1', 'M', 1800, 1), mk('ml2', 'M', 1790, 1), mk('ml3', 'M', 1780, 1), mk('ml4', 'M', 1770, 1),
    ];

    const assignments = assignCourts(players, 3, [], {
      totalCourtCount: 3,
      targetCourtIds: [1, 2, 3],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      useObjectiveEngine: false,
    });

    // どのコートも性別3-1（男1女3 or 男3女1）になっていない
    for (const a of assignments) {
      const genders = [...a.teamA, ...a.teamB].map(id => players.find(p => p.id === id)!.gender);
      const maleCount = genders.filter(g => g === 'M').length;
      expect(maleCount === 1 || maleCount === 3).toBe(false);
    }

    // f1(upperの少数派)を含むコートに、待機列から呼び戻された f4 か f5 が
    // 合流しているはず（mu1-3のうち1人がベンチに回る）
    const f1Court = assignments.find(a => [...a.teamA, ...a.teamB].includes('f1'));
    const f1Mates = [...f1Court!.teamA, ...f1Court!.teamB];
    expect(f1Mates.includes('f4') || f1Mates.includes('f5')).toBe(true);
  });

  it('（旧エンジン）待機が1人以下のときはベンチ入れ替えを行わない（性別3-1が残る）', () => {
    // 上のテストから待機側の f5 を削り13人にする（M8+F5→M8+F4=13人、
    // F4/13≈30.8%≥30% → preferGenderMix=false のまま）。
    // middleが6人→5人になり、選出後の待機は f4 の1人だけになる。
    // 待機1人だと入れ替え方向が一方向にしか成立せずフェアネスが崩れるため
    // （詳細は repairGenderParityWithBench コメント参照）、意図的に対象外にしている。
    //
    // 新エンジンはこの制限を持たず 2-2 まで解消する（`normalizeSplit` 導入後に
    // 到達するようになった）ため、旧エンジン固定で検証する。
    const players: Player[] = [
      mk('mu1', 'M', 2000, 5), mk('mu2', 'M', 1990, 5), mk('mu3', 'M', 1980, 5), mk('f1', 'F', 1970, 5),
      mk('mm1', 'M', 1900, 1), mk('mm2', 'M', 1890, 1), mk('f2', 'F', 1880, 1), mk('f3', 'F', 1870, 1),
      mk('f4', 'F', 1860, 5),
      mk('ml1', 'M', 1800, 1), mk('ml2', 'M', 1790, 1), mk('ml3', 'M', 1780, 1), mk('ml4', 'M', 1770, 1),
    ];

    const assignments = assignCourts(players, 3, [], {
      totalCourtCount: 3,
      targetCourtIds: [1, 2, 3],
      practiceStartTime: 0,
      useStayDurationPriority: false,
      useObjectiveEngine: false,
    });

    // f1を含むコートは3-1（男3女1）のまま修復されない
    const f1Court = assignments.find(a => [...a.teamA, ...a.teamB].includes('f1'));
    const genders = [...f1Court!.teamA, ...f1Court!.teamB].map(id => players.find(p => p.id === id)!.gender);
    expect(genders.filter(g => g === 'M').length).toBe(3);
  });

  it('呼び戻す待機者がベンチに回す人より既に多く出場している場合は入れ替えない（フェアネス優先）', () => {
    // 最初のテストと同じ構成だが、待機に回る f4/f5 の gamesPlayed を
    // mu1-3 より大きくする（呼び戻すと呼び戻す側がベンチ側より多く出場した
    // 状態になる）。この場合は入れ替えを行わず、性別3-1が残る。
    const players: Player[] = [
      mk('mu1', 'M', 2000, 1), mk('mu2', 'M', 1990, 1), mk('mu3', 'M', 1980, 1), mk('f1', 'F', 1970, 1),
      mk('mm1', 'M', 1900, 1), mk('mm2', 'M', 1890, 1), mk('f2', 'F', 1880, 1), mk('f3', 'F', 1870, 1),
      mk('f4', 'F', 1860, 10), mk('f5', 'F', 1850, 10),
      mk('ml1', 'M', 1800, 1), mk('ml2', 'M', 1790, 1), mk('ml3', 'M', 1780, 1), mk('ml4', 'M', 1770, 1),
    ];

    const assignments = assignCourts(players, 3, [], {
      totalCourtCount: 3,
      targetCourtIds: [1, 2, 3],
      practiceStartTime: 0,
      useStayDurationPriority: false,
    });

    const f1Court = assignments.find(a => [...a.teamA, ...a.teamB].includes('f1'));
    const genders = [...f1Court!.teamA, ...f1Court!.teamB].map(id => players.find(p => p.id === id)!.gender);
    expect(genders.filter(g => g === 'M').length).toBe(3);
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

  it('序列近接: 他条件が拮抗時に序列の近い同士が選ばれる', () => {
    // 全員 gamesPlayed=1, lastPlayedAt=古い (=ペナルティ無し), 未対戦
    // 候補プールは a(1400), b(1500), c(1550), d(1700) → 序列は d, c, b, a（順位 0..3）
    // 順位差の合計は a-b + c-d = 1+1 = 2、b-c + a-d = 1+3 = 4
    // 期待: 合計の小さい a-b, c-d が選ばれる
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

  it('レート未設定の人がタイブレークのせいでベンチに回されない', () => {
    // 旧実装は未設定レートを 1500 に正規化してレート差を取っていた。このクラブの
    // レートは 15〜37 なので差が約 1470 になり、重み 0.02 でもコスト 29.4 と
    // 総当たり1対戦(10)を超える。結果、レート未設定の人を含むペアが一律に高コスト
    // になり、候補が余っているとその人だけ出場から外れていた。
    // 順位差なら buildInitialOrder が未設定者を中位へ挿入するので、この歪みは出ない。
    const players = [
      createSinglesPlayer('p0', { rating: 37, gamesPlayed: 2, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('p1', { rating: 30, gamesPlayed: 2, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('p2', { rating: 24, gamesPlayed: 2, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      createSinglesPlayer('p3', { rating: 19, gamesPlayed: 2, lastPlayedAt: NOW - 30 * 60 * 1000 }),
      // ヘルパーは rating:1500 を既定にするので、明示的に undefined を渡して未設定にする
      createSinglesPlayer('u', { rating: undefined, gamesPlayed: 2, lastPlayedAt: NOW - 30 * 60 * 1000 }),
    ];

    const assignments = assignCourts(players, 2, [], {
      totalCourtCount: 2,
      targetCourtIds: [1, 2],
      practiceStartTime: NOW - 60 * 60 * 1000,
      allPlayers: players,
      gameMode: 'singles',
    });

    const playing = assignments.flatMap(a => [a.teamA[0], a.teamB[0]]);
    expect(playing).toHaveLength(4);
    expect(playing, `レート未設定の u が外された [${playing.join(', ')}]`).toContain('u');
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

  it('回数公平 > 総当たり: 試合数の少ないペアは対戦済みでも優先される', () => {
    // a,b: gamesPlayed=1, 過去3回対戦（総当たり的には避けたい）
    // c,d: gamesPlayed=5, 未対戦（総当たり的には嬉しい）
    // 全員十分休息済み（recency=0）→ 回数公平が総当たりより強ければ、
    // 対戦済みでも試合数の少ない a-b が選ばれる
    const players = [
      createSinglesPlayer('a', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('b', { gamesPlayed: 1, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('c', { gamesPlayed: 5, lastPlayedAt: NOW - 60 * 60 * 1000 }),
      createSinglesPlayer('d', { gamesPlayed: 5, lastPlayedAt: NOW - 60 * 60 * 1000 }),
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
      useStayDurationPriority: false,
      gameMode: 'singles',
    });

    const picked = [assignments[0].teamA[0], assignments[0].teamB[0]].sort();
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

  it('待機時間優先モードではスコア減算を行わない（密度の順番が保たれる）', () => {
    // 9人・2コート（必要8人・余剰1人）。余剰1人だと公平性の窓は不発になるので、
    // ベンチ1枠を誰が引くかはスコア減算の有無だけで決まる。
    //
    // L(遅参加): 試合数2 / 滞在30分  → 密度 0.067（最も高い＝最も優先度が低い）
    // 他8人:     試合数6 / 滞在120分 → 密度 0.050
    //
    // 密度で見れば L が最下位だが、回数で見れば L は gap=4 で最優先。
    // 減算が効いていると L がコートに入り、密度で最優先の人が弾かれてしまう
    // （修正前は実際に p6 がベンチに回った）。
    const START = NOW - 120 * 60 * 1000;
    const players: Player[] = Array.from({ length: 9 }, (_, i) => {
      const late = i === 8;
      return {
        id: late ? 'L' : `p${i}`,
        name: late ? 'L' : `P${i}`,
        gender: i % 2 === 0 ? ('M' as const) : ('F' as const),
        rating: 40 - i,
        gamesPlayed: late ? 2 : 6,
        isResting: false,
        lastPlayedAt: 0,
        activatedAt: late ? NOW - 30 * 60 * 1000 : START,
        operationStatus: { payment: true, roster: true, checkin: true },
        opsCompletedAt: late ? NOW - 30 * 60 * 1000 : START,
      };
    });

    const benchOf = (lateBalanceMode: boolean): string[] => {
      const assignments = assignCourts(players, 2, [], {
        totalCourtCount: 2,
        targetCourtIds: [1, 2],
        practiceStartTime: START,
        allPlayers: players,
        useStayDurationPriority: true,
        lateBalanceMode,
      });
      const picked = new Set(assignments.flatMap(c => [...c.teamA, ...c.teamB]));
      return players.filter(p => !picked.has(p.id)).map(p => p.id);
    };

    expect(benchOf(false)).toEqual(['L']);
    expect(benchOf(true)).toEqual(['L']);
  });

  it('（旧エンジン）lateBalanceMode=false (既定) では同シナリオで gender 3-1 が回避され男性 4人が選ばれる', () => {
    // 旧エンジン専用: 非少数派希薄時に 4-0 を 2-2(MIX) より積極優先する固定加点
    // （GENDER_MIX_PENALTY 等）に依存している。新エンジンの `computeGender` は
    // preferGenderMix=false のとき 4-0 と 2-2 を同値（0）で扱うため、3-1 さえ
    // 避けられれば優先度（公平性）どおり最も待っている p5 を含む2-2が選ばれてよく、
    // これは目的関数上の劣化ではない（新エンジンには存在しない仕組みへの依存）。
    //
    // p6(F, gp=100)を追加して少数派を2人にする（バランスが取れる構成）。
    // 少数派が p5 だけ（1人）だと 2-2 が物理的に作れないため 3-1 ペナルティ自体が
    // 無効化される（別 describe 参照）。p6 は gp=100 で優先度が著しく低く
    // どの組にも選ばれないため、p1-p5 だけの探索と実質的に同じ結果になる。
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 10),
      createGenderedPlayer('p3', 'M', 10),
      createGenderedPlayer('p4', 'M', 10),
      createGenderedPlayer('p5', 'F', 8),
      createGenderedPlayer('p6', 'F', 100),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      // lateBalanceMode: false (default)
      useObjectiveEngine: false,
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    // 4-0 (同性) が 3-1 より優先されるので p5 (F) は選ばれない
    expect(picked.has('p5')).toBe(false);
  });

  it('（旧エンジン）lateBalanceMode=true でも gap=1 のときは gender 3-1 が依然回避される', () => {
    // 旧エンジン専用: 上のテストと同じく「4-0 を 2-2 より積極優先する固定加点」と、
    // lateBalance のペナルティ量（-2.0 等）との比較という旧エンジン固有の
    // 加算方式に依存している。新エンジンには該当する仕組みが無い。
    //
    // gap=1 → lateBalance ペナルティ -2.0 が gender 3-1 ペナルティ +3.0 に劣る
    // p6(F, gp=100)を追加して少数派を2人にする（バランスが取れる構成、理由は上のテスト参照）
    const players: Player[] = [
      createGenderedPlayer('p1', 'M', 10),
      createGenderedPlayer('p2', 'M', 10),
      createGenderedPlayer('p3', 'M', 10),
      createGenderedPlayer('p4', 'M', 10),
      createGenderedPlayer('p5', 'F', 9),
      createGenderedPlayer('p6', 'F', 100),
    ];

    const assignments = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      lateBalanceMode: true,
      useObjectiveEngine: false,
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

  it('予約メンバーの試合数が中央値+閾値以上だと予約が保留され、超過メンバーは割り込めない', () => {
    const players = makePlayers();
    const assignments = assignCourts(players, 1, [], {
      ...baseOptions,
      allPlayers: players,
      reservations: [makeReservation(['p1', 'p2', 'p3', 'p4'])],
      reservationBlockThreshold: 2, // p1 の gap=10 >= 2 → 保留
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    // 予約は保留され、試合数が突出した p1 は予約で割り込めない（通常配置でも低優先で選ばれない）。
    // 共メンバー（p2-p4, 0試合）は除外されず通常配置で試合に入れる（飢餓を防ぐ）。
    expect(picked.has('p1')).toBe(false);
    expect(picked.size).toBe(4);
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

describe('assignCourts - 休憩中メンバーの予約配置 (restingPlayers)', () => {
  const NOW = Date.now();
  const makePlayer = (id: string, gamesPlayed: number, isResting: boolean): Player => ({
    id,
    name: id.toUpperCase(),
    rating: 1500,
    gamesPlayed,
    isResting,
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

  it('休憩中の4人予約を配置し、全員を activatedFromRestIds に含める', () => {
    // 予約4人は休憩中、待機にも別途4人いる
    const reserved = ['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 1, true));
    const waiting = ['w1', 'w2', 'w3', 'w4'].map(id => makePlayer(id, 1, false));

    const assignments = assignCourts(waiting, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      allPlayers: waiting,
      restingPlayers: reserved,
      reservations: [makeReservation(['r1', 'r2', 'r3', 'r4'])],
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked).toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
    expect(new Set(assignments[0].activatedFromRestIds)).toEqual(
      new Set(['r1', 'r2', 'r3', 'r4'])
    );
  });

  it('2人予約（休憩中）は待機者で補充し、補充側は activatedFromRestIds に含めない', () => {
    const reserved = ['r1', 'r2'].map(id => makePlayer(id, 1, true));
    const waiting = ['w1', 'w2', 'w3', 'w4'].map(id => makePlayer(id, 1, false));

    const assignments = assignCourts(waiting, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      allPlayers: waiting,
      restingPlayers: reserved,
      reservations: [makeReservation(['r1', 'r2'])],
    });

    const picked = new Set([...assignments[0].teamA, ...assignments[0].teamB]);
    expect(picked.has('r1')).toBe(true);
    expect(picked.has('r2')).toBe(true);
    expect(picked.size).toBe(4);
    // 休憩から出場するのは予約メンバーのみ。補充の待機者は含めない。
    expect(new Set(assignments[0].activatedFromRestIds)).toEqual(new Set(['r1', 'r2']));
  });
});

describe('assignCourts - 人数不足時の部分配置', () => {
  const NOW = Date.now();
  const makePlayer = (id: string, gamesPlayed = 1, isResting = false): Player => ({
    id,
    name: id.toUpperCase(),
    rating: 1500,
    gamesPlayed,
    isResting,
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
  const baseOptions = {
    totalCourtCount: 2,
    targetCourtIds: [1, 2],
    practiceStartTime: NOW - 60 * 60 * 1000,
    useStayDurationPriority: false,
  };

  it('2コート要求で待機6人なら1コートだけ配置する（従来はエラー）', () => {
    const waiting = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(id => makePlayer(id));
    const assignments = assignCourts(waiting, 2, [], {
      ...baseOptions,
      allPlayers: waiting,
    });

    expect(assignments.length).toBe(1);
    expect(assignments[0].courtId).toBe(1);
    const picked = [...assignments[0].teamA, ...assignments[0].teamB];
    expect(new Set(picked).size).toBe(4);
  });

  it('2コート10人+4人予約が保留のとき、待機6人で1コートだけ配置する', () => {
    // 予約メンバーは試合数が突出 → 中央値+閾値で保留。従来は insufficient-players
    // で 1 コートも配置されなかった。
    const reserved = ['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 10, true));
    const waiting = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(id => makePlayer(id, 0));

    const assignments = assignCourts(waiting, 2, [], {
      ...baseOptions,
      allPlayers: waiting,
      restingPlayers: reserved,
      reservations: [makeReservation(['r1', 'r2', 'r3', 'r4'])],
      reservationBlockThreshold: 2,
    });

    expect(assignments.length).toBe(1);
    const picked = [...assignments[0].teamA, ...assignments[0].teamB];
    // 保留された予約メンバーは入らない
    expect(picked.some(id => id.startsWith('r'))).toBe(false);
  });

  it('2コート10人+4人予約が成立可能なとき、予約コート+通常コートの2面が配置される', () => {
    const reserved = ['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 1, true));
    const waiting = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(id => makePlayer(id, 1));

    const assignments = assignCourts(waiting, 2, [], {
      ...baseOptions,
      allPlayers: waiting,
      restingPlayers: reserved,
      reservations: [makeReservation(['r1', 'r2', 'r3', 'r4'])],
    });

    expect(assignments.length).toBe(2);
    const reservedCourt = assignments.find(a => a.teamA.includes('r1'))!;
    expect(new Set([...reservedCourt.teamA, ...reservedCourt.teamB]))
      .toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
  });

  it('1コートも埋められない場合は従来どおりエラー', () => {
    const waiting = ['w1', 'w2', 'w3'].map(id => makePlayer(id));
    expect(() => assignCourts(waiting, 2, [], {
      ...baseOptions,
      allPlayers: waiting,
    })).toThrow();
  });

  it('シングルス: 3コート要求で待機4人なら2コートだけ配置する', () => {
    const waiting = ['w1', 'w2', 'w3', 'w4'].map(id => makePlayer(id));
    const assignments = assignCourts(waiting, 3, [], {
      totalCourtCount: 3,
      targetCourtIds: [1, 2, 3],
      practiceStartTime: NOW - 60 * 60 * 1000,
      useStayDurationPriority: false,
      allPlayers: waiting,
      gameMode: 'singles',
    });

    expect(assignments.length).toBe(2);
  });
});

describe('getCallableReservationRestingIds', () => {
  const NOW = Date.now();
  const makePlayer = (id: string, gamesPlayed = 0, isResting = false): Player => ({
    id,
    name: id.toUpperCase(),
    rating: 1500,
    gamesPlayed,
    isResting,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * 60 * 1000,
  });
  const makeReservation = (playerIds: string[], status: 'pending' | 'fulfilled' = 'pending'): Reservation => ({
    id: `rsv-${playerIds.join('-')}`,
    orderNumber: 1,
    playerIds,
    status,
    createdAt: NOW,
    fulfilledAt: 0,
  });

  it('成立可能な4人予約の休憩メンバー全員を返す', () => {
    const players = [
      ...['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 0, true)),
      ...['w1', 'w2'].map(id => makePlayer(id)),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2', 'r3', 'r4'])], new Set()
    );
    expect(result).toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
  });

  it('予約メンバーがコートで試合中なら数えない', () => {
    const players = [
      ...['r1', 'r2', 'r3'].map(id => makePlayer(id, 0, true)),
      makePlayer('r4'),
      ...['w1', 'w2'].map(id => makePlayer(id)),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2', 'r3', 'r4'])], new Set(['r4'])
    );
    expect(result.size).toBe(0);
  });

  it('試合数が中央値+閾値以上のメンバーを含む予約（保留対象）は数えない', () => {
    const players = [
      makePlayer('r1', 10, true),
      ...['r2', 'r3', 'r4'].map(id => makePlayer(id, 0, true)),
      ...['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(id => makePlayer(id, 0)),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2', 'r3', 'r4'])], new Set(),
      { reservationBlockThreshold: 2 }
    );
    expect(result.size).toBe(0);
  });

  it('待機者で残り枠を補充できない予約は数えない（2人予約+待機1人）', () => {
    const players = [
      ...['r1', 'r2'].map(id => makePlayer(id, 0, true)),
      makePlayer('w1'),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2'])], new Set()
    );
    expect(result.size).toBe(0);
  });

  it('2人予約+待機2人なら数える', () => {
    const players = [
      ...['r1', 'r2'].map(id => makePlayer(id, 0, true)),
      ...['w1', 'w2'].map(id => makePlayer(id)),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2'])], new Set()
    );
    expect(result).toEqual(new Set(['r1', 'r2']));
  });

  it('fulfilled 予約は数えない', () => {
    const players = [
      ...['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 0, true)),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2', 'r3', 'r4'], 'fulfilled')], new Set()
    );
    expect(result.size).toBe(0);
  });

  it('シングルスでは3人以上の予約を数えない', () => {
    const players = [
      ...['r1', 'r2', 'r3'].map(id => makePlayer(id, 0, true)),
      makePlayer('w1'),
    ];
    const result = getCallableReservationRestingIds(
      players, [makeReservation(['r1', 'r2', 'r3'])], new Set(),
      { gameMode: 'singles' }
    );
    expect(result.size).toBe(0);
  });

  it('複数予約にまたがるメンバーは重複なく数える', () => {
    const players = [
      ...['r1', 'r2', 'r3', 'r4'].map(id => makePlayer(id, 0, true)),
      ...['w1', 'w2', 'w3', 'w4'].map(id => makePlayer(id)),
    ];
    const result = getCallableReservationRestingIds(
      players,
      [makeReservation(['r1', 'r2']), makeReservation(['r1', 'r3', 'r4'])],
      new Set()
    );
    expect(result).toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
  });
});

describe('sortWaitingPlayers - 滞在時間モードの起点（opsCompletedAt）', () => {
  // docs/plans/2026-08-11-stay-start-at-ops-complete.md
  const NOW = 20_000_000;
  const practiceStartTime = NOW - 6 * 60 * 60 * 1000; // 6時間前（どのケースでも起点より前）

  const makeOpsPlayer = (
    id: string,
    gamesPlayed: number,
    overrides: Partial<Player> = {},
  ): Player => ({
    id,
    name: id,
    gamesPlayed,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: 0,
    operationStatus: { payment: true, roster: true, checkin: false },
    ...overrides,
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  const sort = (players: Player[]) =>
    sortWaitingPlayers(players, {
      emptyCourtIds: [],
      totalCourtCount: 1,
      matchHistory: [],
      allActivePlayers: players,
      practiceStartTime,
      useStayDuration: true,
    });

  it('同じ gamesPlayed なら opsCompletedAt が古い（滞在が長い）人が優先される', () => {
    const players = [
      makeOpsPlayer('a', 4, { opsCompletedAt: NOW - 60 * 60 * 1000 }), // 60分前完了
      makeOpsPlayer('b', 4, { opsCompletedAt: NOW - 10 * 60 * 1000 }), // 10分前完了
    ];
    const sorted = sort(players);
    expect(sorted.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('activatedAt が古くても opsCompletedAt が新しければ優先されない（起点が opsCompletedAt に変わったことの確認）', () => {
    const players = [
      // activatedAt は古い（5時間前）が、会費・名簿の完了は5分前 → 滞在は短い扱い
      makeOpsPlayer('a', 4, {
        activatedAt: NOW - 5 * 60 * 60 * 1000,
        opsCompletedAt: NOW - 5 * 60 * 1000,
      }),
      // activatedAt は新しい（30分前）が、完了は40分前 → 滞在は長い扱い
      makeOpsPlayer('b', 4, {
        activatedAt: NOW - 30 * 60 * 1000,
        opsCompletedAt: NOW - 40 * 60 * 1000,
      }),
    ];
    const sorted = sort(players);
    // activatedAt だけを見れば a が古参で優先されるはずだが、opsCompletedAt 基準では b が優先される
    expect(sorted.map(p => p.id)).toEqual(['b', 'a']);
  });

  it('会費・名簿どちらか未完了かつ gamesPlayed > 0 のメンバーは、完了済みで滞在の長い同回数メンバーより後回しになる', () => {
    const players = [
      makeOpsPlayer('unresolved', 3, {
        operationStatus: { payment: false, roster: true, checkin: false },
      }),
      makeOpsPlayer('resolved', 3, { opsCompletedAt: NOW - 60 * 60 * 1000 }),
    ];
    const sorted = sort(players);
    expect(sorted.map(p => p.id)).toEqual(['resolved', 'unresolved']);
  });

  it('opsCompletedAt 未設定 & 両方完了（既存セッション互換）は従来どおり activatedAt 起点で動く', () => {
    const players = [
      makeOpsPlayer('a', 2, { activatedAt: NOW - 50 * 60 * 1000 }), // opsCompletedAt なし
      makeOpsPlayer('b', 2, { activatedAt: NOW - 10 * 60 * 1000 }), // opsCompletedAt なし
    ];
    const sorted = sort(players);
    expect(sorted.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('gamesPlayed === 0 は会費・名簿未完了でも最優先（初回保証）が維持される', () => {
    const players = [
      makeOpsPlayer('resolvedLongStay', 5, { opsCompletedAt: NOW - 120 * 60 * 1000 }),
      makeOpsPlayer('unresolvedFirstTime', 0, {
        operationStatus: { payment: false, roster: false, checkin: false },
      }),
    ];
    const sorted = sort(players);
    expect(sorted[0].id).toBe('unresolvedFirstTime');
  });
});

describe('assignCourts - ハシゴ式（applyStreakSwaps）が新エンジンにも効く', () => {
  const NOW = 1_700_000_000_000;
  const N = 17;

  /** 対象者が全勝 / 全敗するセッションを回し、対戦相手の平均序列を返す */
  const meanOpponentRank = (targetAlwaysWins: boolean): number => {
    const target = 'p8'; // 序列9位（真ん中）
    const players: Player[] = Array.from({ length: N }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      gender: i % 3 === 0 ? ('F' as const) : ('M' as const),
      rating: 40 - i,
      gamesPlayed: 0,
      isResting: false,
      lastPlayedAt: 0,
      activatedAt: 0,
      operationStatus: { payment: true, roster: true, checkin: true },
      opsCompletedAt: NOW,
    }));
    const history: Match[] = [];
    const opponents: number[] = [];

    for (let round = 0; round < 25; round++) {
      vi.spyOn(Date, 'now').mockReturnValue(NOW + round * 8 * 60_000);
      const assignments = assignCourts(players, 3, history, {
        totalCourtCount: 3,
        targetCourtIds: [1, 2, 3],
        practiceStartTime: NOW,
        allPlayers: players,
        useStayDurationPriority: true,
      });
      for (const c of assignments) {
        const ids = [...c.teamA, ...c.teamB];
        const inA = c.teamA.includes(target);
        // 対象者の勝敗だけ固定する。対象者がいないコートは A の勝ちで揃える
        const aWins = ids.includes(target) ? (targetAlwaysWins ? inA : !inA) : true;
        if (ids.includes(target)) {
          opponents.push(...(inA ? c.teamB : c.teamA).map(x => Number(x.slice(1)) + 1));
        }
        history.push({
          id: `m${history.length}`,
          courtId: c.courtId,
          teamA: c.teamA,
          teamB: c.teamB,
          scoreA: aWins ? 21 : 15,
          scoreB: aWins ? 15 : 21,
          startedAt: 0,
          finishedAt: 0,
          winner: aWins ? 'A' : 'B',
        } as Match);
        for (const id of ids) {
          const p = players.find(x => x.id === id)!;
          p.gamesPlayed += 1;
        }
      }
    }
    return opponents.reduce((a, b) => a + b, 0) / opponents.length;
  };

  it('勝ち続けると対戦相手が強くなり、負け続けると弱くなる', () => {
    const whenWinning = meanOpponentRank(true);
    const whenLosing = meanOpponentRank(false);

    // ハシゴ式が無いと勝敗が組み合わせに一切影響せず、両者は完全に一致する
    // （実装前の実測では差 0.00 だった）。
    expect(whenLosing - whenWinning).toBeGreaterThan(1);
  });
});

describe('buildRanksWithTies', () => {
  const mk = (id: string, rating: number): Player => ({
    id, name: id, rating, gamesPlayed: 0, isResting: false, lastPlayedAt: 0, activatedAt: 0,
  });

  it('レートが全部違えば従来どおり 0,1,2,... になる', () => {
    const players = [mk('a', 40), mk('b', 30), mk('c', 20)];
    const ranks = buildRanksWithTies(['a', 'b', 'c'], players);
    expect([...ranks.values()]).toEqual([0, 1, 2]);
  });

  it('同点レートで隣り合う人は同順位になり、次は index に戻る（競技順位方式）', () => {
    const players = [mk('a', 40), mk('b', 30), mk('c', 30), mk('d', 30), mk('e', 20)];
    const ranks = buildRanksWithTies(['a', 'b', 'c', 'd', 'e'], players);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(1);
    expect(ranks.get('d')).toBe(1);
    // 同点の次は 4（3 ではない）。目盛りが 0..n-1 のまま保たれる
    expect(ranks.get('e')).toBe(4);
  });

  it('全員同レートなら全員が同順位（順位差が丸ごと消える）', () => {
    const players = ['a', 'b', 'c', 'd'].map(id => mk(id, 1500));
    const ranks = buildRanksWithTies(['a', 'b', 'c', 'd'], players);
    expect([...ranks.values()]).toEqual([0, 0, 0, 0]);
  });

  it('未設定レート（0 / undefined）どうしも同点として扱う', () => {
    const players = [mk('a', 40), { ...mk('b', 0), rating: undefined as unknown as number }, mk('c', 0), mk('d', 20)];
    const ranks = buildRanksWithTies(['a', 'b', 'c', 'd'], players);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(1);
    expect(ranks.get('d')).toBe(3);
  });

  it('同点でも並びで離れていれば別順位（ハシゴ式で引き離された差は残す）', () => {
    // b と d は同レートだが、あいだに別レートの c が入っている
    const players = [mk('a', 40), mk('b', 30), mk('c', 25), mk('d', 30)];
    const ranks = buildRanksWithTies(['a', 'b', 'c', 'd'], players);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('d')).toBe(3);
  });
});
