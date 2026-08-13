import { describe, it, expect } from 'vitest';
import { shouldCallNextMatch, maxPlayingElapsedMs } from './nextMatchCall';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import type { Court } from '../types/court';
import { EMPTY_COURT_STATE } from '../types/court';

const NOW = 1_700_000_000_000;

const emptyCourt = (id: number): Court => ({ id, ...EMPTY_COURT_STATE, restingPlayerIds: [] });

const playingCourt = (
  id: number,
  startedAt: number,
  teamA: [string, string] = ['p1', 'p2'],
  teamB: [string, string] = ['p3', 'p4'],
): Court => ({
  id,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  isPlaying: true,
  startedAt,
  finishedAt: 0,
  restingPlayerIds: [],
});

describe('maxPlayingElapsedMs', () => {
  it('プレイ中コートが無ければ 0', () => {
    expect(maxPlayingElapsedMs([emptyCourt(1)], NOW)).toBe(0);
  });

  it('プレイ中コートが無い（コート自体が無い）場合も 0', () => {
    expect(maxPlayingElapsedMs([], NOW)).toBe(0);
  });

  it('startedAt === 0（準備中コート）は経過時間の計算対象外', () => {
    const court: Court = { ...playingCourt(1, 0), startedAt: 0 };
    expect(maxPlayingElapsedMs([court], NOW)).toBe(0);
  });

  it('複数のプレイ中コートのうち最大の経過時間を返す', () => {
    const courts = [
      playingCourt(1, NOW - 3 * 60 * 1000),
      playingCourt(2, NOW - 7 * 60 * 1000),
      emptyCourt(3),
    ];
    expect(maxPlayingElapsedMs(courts, NOW)).toBe(7 * 60 * 1000);
  });
});

describe('shouldCallNextMatch', () => {
  const baseArgs = {
    courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS)],
    certainIds: new Set(['me']),
    myPlayerId: 'me',
    now: NOW,
    alreadyCalled: false,
  };

  it('閾値以上なら true', () => {
    expect(shouldCallNextMatch(baseArgs)).toBe(true);
  });

  it('閾値未満では false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - (MATCH_CALL_THRESHOLD_MS - 1))],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('certainIds に自分が居なければ false', () => {
    const args = { ...baseArgs, certainIds: new Set(['someone-else']) };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('alreadyCalled が true なら false', () => {
    const args = { ...baseArgs, alreadyCalled: true };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('自分が既にコートに乗っていれば false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS, ['me', 'p2'], ['p3', 'p4'])],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('自分が teamB に乗っている場合も false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS, ['p1', 'p2'], ['me', 'p4'])],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('myPlayerId が null なら false', () => {
    const args = { ...baseArgs, myPlayerId: null };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('プレイ中コートが無ければ false（maxPlayingElapsedMs が 0）', () => {
    const args = { ...baseArgs, courts: [emptyCourt(1)] };
    expect(shouldCallNextMatch(args)).toBe(false);
  });
});
