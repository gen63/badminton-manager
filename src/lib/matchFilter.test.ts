import { describe, it, expect } from 'vitest';
import { isMatchOfPlayer } from './matchFilter';
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
