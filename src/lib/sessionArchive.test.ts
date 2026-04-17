import { describe, it, expect } from 'vitest';
import type { Match } from '../types/match';
import {
  ARCHIVE_THRESHOLD_MS,
  computeFirstMatchStartedAt,
  isSessionVisible,
} from './sessionArchive';

function makeMatch(startedAt: number, id = `m-${startedAt}`): Match {
  return {
    id,
    courtId: 1,
    teamA: ['A1', 'A2'],
    teamB: ['B1', 'B2'],
    scoreA: 0,
    scoreB: 0,
    startedAt,
    finishedAt: startedAt + 1000,
  };
}

describe('computeFirstMatchStartedAt', () => {
  it('空配列はnullを返す', () => {
    expect(computeFirstMatchStartedAt([])).toBeNull();
  });

  it('試合1件ならその開始時刻を返す', () => {
    expect(computeFirstMatchStartedAt([makeMatch(1000)])).toBe(1000);
  });

  it('複数試合の最小値を返す（順不同）', () => {
    const matches = [makeMatch(3000), makeMatch(1000), makeMatch(2000)];
    expect(computeFirstMatchStartedAt(matches)).toBe(1000);
  });
});

describe('isSessionVisible', () => {
  const now = 1_700_000_000_000;

  it('firstMatchStartedAtがundefinedなら表示', () => {
    expect(isSessionVisible({}, now)).toBe(true);
  });

  it('firstMatchStartedAtがnullなら表示（試合未開始）', () => {
    expect(isSessionVisible({ firstMatchStartedAt: null }, now)).toBe(true);
  });

  it('11時間59分前なら表示', () => {
    const t = now - (11 * 60 + 59) * 60 * 1000;
    expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(true);
  });

  it('ちょうど12時間前なら非表示（厳密な>）', () => {
    const t = now - ARCHIVE_THRESHOLD_MS;
    expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(false);
  });

  it('12時間1秒前なら非表示', () => {
    const t = now - ARCHIVE_THRESHOLD_MS - 1000;
    expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(false);
  });

  it('未来時刻（時計ずれ）なら表示', () => {
    const t = now + 60_000;
    expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(true);
  });
});
