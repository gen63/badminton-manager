import { describe, it, expect } from 'vitest';
import { pickNextUnrecordedMatchForUser } from './unrecordedMatchPrompt';
import { activeDismissedSet } from '../stores/unrecordedDismissStore';
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
  id: string,
  teamA: [string, string],
  teamB: [string, string],
  overrides: Partial<Match> = {},
): Match => ({
  id,
  courtId: 1,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  startedAt: 0,
  finishedAt: 1,
  ...overrides,
});

describe('pickNextUnrecordedMatchForUser', () => {
  const players: Player[] = [
    makePlayer('id-alice', 'Alice'),
    makePlayer('id-bob', 'Bob'),
    makePlayer('id-carol', 'Carol'),
    makePlayer('id-dave', 'Dave'),
  ];
  const empty = new Set<string>();

  it('currentUser が null なら null', () => {
    const res = pickNextUnrecordedMatchForUser(
      [makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'])],
      null,
      players,
      empty,
    );
    expect(res).toBeNull();
  });

  it('参加していない試合は無視', () => {
    const res = pickNextUnrecordedMatchForUser(
      [makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'])],
      'Eve',
      players,
      empty,
    );
    expect(res).toBeNull();
  });

  it('未入力かつ参加している試合を返す', () => {
    const res = pickNextUnrecordedMatchForUser(
      [makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'])],
      'Alice',
      players,
      empty,
    );
    expect(res?.id).toBe('1');
  });

  it('winner が入っている試合は除外', () => {
    const res = pickNextUnrecordedMatchForUser(
      [
        makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'], {
          winner: 'A',
          scoreA: 100,
          scoreB: 99,
        }),
      ],
      'Alice',
      players,
      empty,
    );
    expect(res).toBeNull();
  });

  it('scoreA/scoreB のいずれかが 0 でない試合は除外（レガシー記録扱い）', () => {
    const res = pickNextUnrecordedMatchForUser(
      [
        makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'], {
          scoreA: 21,
          scoreB: 15,
        }),
      ],
      'Alice',
      players,
      empty,
    );
    expect(res).toBeNull();
  });

  it('dismissed に入っている試合は除外', () => {
    const res = pickNextUnrecordedMatchForUser(
      [makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave'])],
      'Alice',
      players,
      new Set(['1']),
    );
    expect(res).toBeNull();
  });

  it('複数件あれば古い順 (matchHistory の先頭) から返す', () => {
    const res = pickNextUnrecordedMatchForUser(
      [
        makeMatch('old', ['id-alice', 'id-bob'], ['id-carol', 'id-dave']),
        makeMatch('new', ['id-alice', 'id-bob'], ['id-carol', 'id-dave']),
      ],
      'Alice',
      players,
      empty,
    );
    expect(res?.id).toBe('old');
  });

  it('シングルス (空文字含む) でも参加判定が動く', () => {
    const res = pickNextUnrecordedMatchForUser(
      [makeMatch('1', ['id-alice', ''], ['id-bob', ''])],
      'Alice',
      players,
      empty,
    );
    expect(res?.id).toBe('1');
  });

  it('dismissed と未入力の混在で「次」を正しく返す', () => {
    const res = pickNextUnrecordedMatchForUser(
      [
        makeMatch('1', ['id-alice', 'id-bob'], ['id-carol', 'id-dave']),
        makeMatch('2', ['id-alice', 'id-bob'], ['id-carol', 'id-dave']),
      ],
      'Alice',
      players,
      new Set(['1']),
    );
    expect(res?.id).toBe('2');
  });
});

describe('activeDismissedSet', () => {
  it('期限が未来のものだけ含む', () => {
    const now = 1_000_000;
    const map = {
      future: now + 60_000,
      past: now - 1,
      exact: now, // until === now は除外（until > now の厳密判定）
    };
    const set = activeDismissedSet(map, now);
    expect(set.has('future')).toBe(true);
    expect(set.has('past')).toBe(false);
    expect(set.has('exact')).toBe(false);
  });

  it('空マップでも空集合を返す', () => {
    expect(activeDismissedSet({}, Date.now()).size).toBe(0);
  });
});
