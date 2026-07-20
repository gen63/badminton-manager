import { describe, it, expect } from 'vitest';
import {
  isMatchOfPlayer,
  getMatchResultForPlayer,
  computePlayerRecord,
} from './matchFilter';
import type { Match } from '../types/match';
import type { Player } from '../types/player';

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
});

const makeMatch = (
  teamA: [string, string],
  teamB: [string, string]
): Match => ({
  id: 'm1',
  courtId: 1,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  startedAt: 0,
  finishedAt: 0,
});

const makeScoredMatch = (
  teamA: [string, string],
  teamB: [string, string],
  winner: 'A' | 'B'
): Match => ({
  ...makeMatch(teamA, teamB),
  scoreA: winner === 'A' ? 21 : 15,
  scoreB: winner === 'B' ? 21 : 15,
  winner,
});

describe('isMatchOfPlayer', () => {
  const players: Player[] = [
    makePlayer('id-alice', 'Alice'),
    makePlayer('id-bob', 'Bob'),
    makePlayer('id-carol', 'Carol'),
    makePlayer('id-dave', 'Dave'),
    makePlayer('id-eve', 'Eve'),
  ];

  it('ダブルスでteamAに自分が含まれる', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, 'Alice', players)).toBe(true);
  });

  it('ダブルスでteamBに自分が含まれる', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, 'Dave', players)).toBe(true);
  });

  it('自分が含まれない試合はfalse', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, 'Eve', players)).toBe(false);
  });

  it('シングルス（空文字含む）で自分が含まれる', () => {
    const match = makeMatch(['id-alice', ''], ['id-bob', '']);
    expect(isMatchOfPlayer(match, 'Alice', players)).toBe(true);
    expect(isMatchOfPlayer(match, 'Bob', players)).toBe(true);
  });

  it('シングルスで含まれない', () => {
    const match = makeMatch(['id-alice', ''], ['id-bob', '']);
    expect(isMatchOfPlayer(match, 'Carol', players)).toBe(false);
  });

  it('playerNameがnullならfalse', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, null, players)).toBe(false);
  });

  it('playerNameが空文字でもfalse（空文字IDと誤一致しない）', () => {
    const match = makeMatch(['id-alice', ''], ['id-bob', '']);
    expect(isMatchOfPlayer(match, '', players)).toBe(false);
  });

  it('該当プレイヤーがplayers配列に存在しないならfalse', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, 'Unknown', players)).toBe(false);
  });

  it('match内のplayer IDがplayers配列に存在しなくてもクラッシュしない', () => {
    const match = makeMatch(['deleted-id', 'id-bob'], ['id-carol', 'id-dave']);
    expect(isMatchOfPlayer(match, 'Bob', players)).toBe(true);
    expect(isMatchOfPlayer(match, 'Alice', players)).toBe(false);
  });

  it('同名プレイヤーが居る場合は最初の一致が使われる（既存仕様の踏襲）', () => {
    const dupePlayers = [
      makePlayer('id-1', 'Same'),
      makePlayer('id-2', 'Same'),
    ];
    const match = makeMatch(['id-2', ''], ['id-1', '']);
    // どちらのIDでも 'Same' が当たればtrue
    expect(isMatchOfPlayer(match, 'Same', dupePlayers)).toBe(true);
  });
});

describe('getMatchResultForPlayer', () => {
  const players: Player[] = [
    makePlayer('id-alice', 'Alice'),
    makePlayer('id-bob', 'Bob'),
    makePlayer('id-carol', 'Carol'),
    makePlayer('id-dave', 'Dave'),
    makePlayer('id-eve', 'Eve'),
  ];

  it('teamAの勝者側なら win', () => {
    const match = makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A');
    expect(getMatchResultForPlayer(match, 'Alice', players)).toBe('win');
  });

  it('teamBの敗者側なら loss', () => {
    const match = makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A');
    expect(getMatchResultForPlayer(match, 'Carol', players)).toBe('loss');
  });

  it('teamBの勝者側なら win', () => {
    const match = makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'B');
    expect(getMatchResultForPlayer(match, 'Dave', players)).toBe('win');
  });

  it('参加していない試合は null', () => {
    const match = makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A');
    expect(getMatchResultForPlayer(match, 'Eve', players)).toBeNull();
  });

  it('勝敗未確定（winner 無し = 未入力）は null', () => {
    const match = makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']);
    expect(getMatchResultForPlayer(match, 'Alice', players)).toBeNull();
  });

  it('playerName が null なら null', () => {
    const match = makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A');
    expect(getMatchResultForPlayer(match, null, players)).toBeNull();
  });

  it('シングルスでも判定できる', () => {
    const match = makeScoredMatch(['id-alice', ''], ['id-bob', ''], 'B');
    expect(getMatchResultForPlayer(match, 'Alice', players)).toBe('loss');
    expect(getMatchResultForPlayer(match, 'Bob', players)).toBe('win');
  });
});

describe('computePlayerRecord', () => {
  const players: Player[] = [
    makePlayer('id-alice', 'Alice'),
    makePlayer('id-bob', 'Bob'),
    makePlayer('id-carol', 'Carol'),
    makePlayer('id-dave', 'Dave'),
  ];

  it('勝敗と勝率を集計する（未入力・不参加は除外）', () => {
    const matches: Match[] = [
      makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A'), // Alice win
      makeScoredMatch(['id-alice', 'id-carol'], ['id-bob', 'id-dave'], 'B'), // Alice loss
      makeScoredMatch(['id-alice', 'id-dave'], ['id-bob', 'id-carol'], 'A'), // Alice win
      makeMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave']), // 未入力 → 除外
      makeScoredMatch(['id-bob', 'id-carol'], ['id-dave', ''], 'A'), // Alice 不参加 → 除外
    ];
    const record = computePlayerRecord(matches, 'Alice', players);
    expect(record).toEqual({ wins: 2, losses: 1, total: 3, winRate: 67 });
  });

  it('試合が無い場合は winRate が null', () => {
    const matches: Match[] = [
      makeScoredMatch(['id-bob', 'id-carol'], ['id-dave', ''], 'A'),
    ];
    const record = computePlayerRecord(matches, 'Alice', players);
    expect(record).toEqual({ wins: 0, losses: 0, total: 0, winRate: null });
  });

  it('全勝なら勝率100', () => {
    const matches: Match[] = [
      makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A'),
      makeScoredMatch(['id-alice', 'id-carol'], ['id-bob', 'id-dave'], 'A'),
    ];
    const record = computePlayerRecord(matches, 'Alice', players);
    expect(record).toEqual({ wins: 2, losses: 0, total: 2, winRate: 100 });
  });

  it('playerName が null なら空の成績', () => {
    const matches: Match[] = [
      makeScoredMatch(['id-alice', 'id-bob'], ['id-carol', 'id-dave'], 'A'),
    ];
    const record = computePlayerRecord(matches, null, players);
    expect(record).toEqual({ wins: 0, losses: 0, total: 0, winRate: null });
  });
});
