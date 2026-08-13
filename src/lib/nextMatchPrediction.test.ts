import { describe, it, expect, vi, afterEach } from 'vitest';
import { predictNextMatchPlayers, LIKELY_THRESHOLD } from './nextMatchPrediction';
import { assignCourts } from './algorithm';
import type { Player } from '../types/player';
import type { Court } from '../types/court';
import type { Match } from '../types/match';
import { EMPTY_COURT_STATE } from '../types/court';

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = 1_700_000_000_000;
const PRACTICE_START = NOW - 60 * 60 * 1000;

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: id,
  gamesPlayed: 0,
  rating: 1500,
  isResting: false,
  lastPlayedAt: 0,
  activatedAt: PRACTICE_START,
  ...overrides,
});

const emptyCourt = (id: number): Court => ({ id, ...EMPTY_COURT_STATE, restingPlayerIds: [] });

const playingCourt = (id: number, teamA: [string, string], teamB: [string, string]): Court => ({
  id,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  isPlaying: true,
  startedAt: NOW - 5 * 60 * 1000,
  finishedAt: 0,
  restingPlayerIds: [],
});

const options = {
  practiceStartTime: PRACTICE_START,
  useStayDurationPriority: false,
  gameMode: 'doubles' as const,
};

const predict = (players: Player[], courts: Court[], matchHistory: Match[] = []) =>
  predictNextMatchPlayers(players, courts, matchHistory, [], options);

describe('predictNextMatchPlayers', () => {
  it('空きコートがある場合、assignCourts の実配置結果と一致する（全員ほぼ確定）', () => {
    const players = Array.from({ length: 6 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts = [emptyCourt(1)];

    const result = predict(players, courts);

    const expected = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: PRACTICE_START,
      allPlayers: players,
      useStayDurationPriority: false,
      reservations: [],
      gameMode: 'doubles',
    });
    const expectedIds = new Set(
      expected.flatMap(a => [...a.teamA, ...a.teamB]).filter(id => id),
    );

    expect(result.scenarioCount).toBe(1);
    expect(result.certainIds).toEqual(expectedIds);
    expect(result.certainIds.size).toBe(4);
    expect(result.likelyIds.size).toBe(0);
  });

  it('predictedTeams は実配置のチーム分け（ペア）と一致する', () => {
    const players = Array.from({ length: 6 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts = [emptyCourt(1)];

    const result = predict(players, courts);

    const expected = assignCourts(players, 1, [], {
      totalCourtCount: 1,
      targetCourtIds: [1],
      practiceStartTime: PRACTICE_START,
      allPlayers: players,
      useStayDurationPriority: false,
      reservations: [],
      gameMode: 'doubles',
    })[0];

    expect(result.predictedTeams).toHaveLength(2);
    expect(result.predictedTeams.map(t => [...t].sort())).toEqual([
      [...expected.teamA].sort(),
      [...expected.teamB].sort(),
    ]);
  });

  it('代表シナリオは選出メンバーの出現率合計が最大のものになる', () => {
    const players = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts = [
      playingCourt(1, ['p1', 'p2'], ['p3', 'p4']),
      playingCourt(2, ['p5', 'p6'], ['p7', 'p8']),
    ];

    const result = predict(players, courts);

    const rateSumOf = (ids: string[]) =>
      ids.reduce((sum, id) => sum + (result.appearanceRate.get(id) ?? 0), 0);
    const chosen = rateSumOf(result.predictedTeams.flat());
    for (const scenario of result.scenarios) {
      expect(chosen).toBeGreaterThanOrEqual(rateSumOf(scenario.playerIds));
    }
  });

  it('1コート稼働中は、そのコートが終わる1シナリオのみで全員ほぼ確定になる', () => {
    const players = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts = [playingCourt(1, ['p1', 'p2'], ['p3', 'p4'])];

    const result = predict(players, courts);

    expect(result.scenarioCount).toBe(1);
    expect(result.certainIds.size).toBe(4);
    expect(result.likelyIds.size).toBe(0);
    // 待機が4人ちょうどなので、コート上の4人ではなく待機の4人が選ばれる
    expect([...result.certainIds].sort()).toEqual(['p5', 'p6', 'p7', 'p8']);
  });

  it('2コート稼働中は各コートの終了をシミュレートし、共通メンバーがほぼ確定になる', () => {
    const players = Array.from({ length: 12 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts = [
      playingCourt(1, ['p1', 'p2'], ['p3', 'p4']),
      playingCourt(2, ['p5', 'p6'], ['p7', 'p8']),
    ];

    const result = predict(players, courts);

    expect(result.scenarioCount).toBe(2);
    // 待機4人 (p9-p12) はどちらのコートが終わっても配置対象になる
    expect([...result.certainIds].sort()).toEqual(['p10', 'p11', 'p12', 'p9']);
  });

  it('待機が足りず配置できない場合は予測を返さない', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    const courts = [emptyCourt(1)];

    const result = predict(players, courts);

    expect(result.scenarioCount).toBe(0);
    expect(result.certainIds.size).toBe(0);
    expect(result.likelyIds.size).toBe(0);
  });

  it('休憩中のメンバーは予測に含まれない', () => {
    const players = [
      ...Array.from({ length: 5 }, (_, i) => makePlayer(`p${i + 1}`)),
      makePlayer('rest1', { isResting: true }),
      makePlayer('rest2', { isResting: true }),
    ];
    const courts = [emptyCourt(1)];

    const result = predict(players, courts);

    expect(result.certainIds.has('rest1')).toBe(false);
    expect(result.certainIds.has('rest2')).toBe(false);
    expect(result.likelyIds.has('rest1')).toBe(false);
    expect(result.likelyIds.has('rest2')).toBe(false);
  });

  it('試合数が多いメンバーより少ないメンバーが優先して予測される', () => {
    const players = [
      makePlayer('few1', { gamesPlayed: 0 }),
      makePlayer('few2', { gamesPlayed: 0 }),
      makePlayer('few3', { gamesPlayed: 0 }),
      makePlayer('few4', { gamesPlayed: 0 }),
      makePlayer('many1', { gamesPlayed: 5 }),
      makePlayer('many2', { gamesPlayed: 5 }),
    ];
    const courts = [emptyCourt(1)];

    const result = predict(players, courts);

    expect([...result.certainIds].sort()).toEqual(['few1', 'few2', 'few3', 'few4']);
  });

  it('準備中（配置済みで未開始）のコートだけの場合はシナリオが作れない', () => {
    const players = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i + 1}`));
    const courts: Court[] = [
      { ...playingCourt(1, ['p1', 'p2'], ['p3', 'p4']), isPlaying: false, startedAt: 0 },
    ];

    const result = predict(players, courts);

    expect(result.scenarioCount).toBe(0);
  });

  it('出現率が閾値未満のメンバーは確定にも候補にも入らない', () => {
    // 3コート稼働・待機8人。どのコートが先に終わるかで選出が割れる状況
    const players = Array.from({ length: 20 }, (_, i) =>
      makePlayer(`p${i + 1}`, {
        gamesPlayed: 3 + (i % 4),
        gender: i % 3 === 0 ? 'F' : 'M',
        rating: 1300 + (i % 7) * 50,
        lastPlayedAt: NOW - (10 + (i % 5) * 6) * 60 * 1000,
      }),
    );
    const courts = [
      playingCourt(1, ['p1', 'p2'], ['p3', 'p4']),
      playingCourt(2, ['p5', 'p6'], ['p7', 'p8']),
      playingCourt(3, ['p9', 'p10'], ['p11', 'p12']),
    ];

    const result = predict(players, courts);

    expect(result.scenarioCount).toBe(3);
    expect(result.appearanceRate.size).toBeGreaterThanOrEqual(4);
    for (const [id, rate] of result.appearanceRate) {
      expect(result.certainIds.has(id)).toBe(rate === 1);
      expect(result.likelyIds.has(id)).toBe(rate >= LIKELY_THRESHOLD && rate < 1);
    }
  });

  it('コートが無い場合は空の予測を返す', () => {
    const players = Array.from({ length: 8 }, (_, i) => makePlayer(`p${i + 1}`));

    const result = predict(players, []);

    expect(result.scenarioCount).toBe(0);
  });
});
