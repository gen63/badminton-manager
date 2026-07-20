import { describe, it, expect } from 'vitest';
import type { Session } from '../types/session';
import {
  resolvePracticeTypeLabel,
  startOfDay,
  deriveFilterOptions,
  applySessionFilters,
} from './sessionFilters';

function makeSession(overrides: {
  id: string;
  gym?: string;
  gameMode?: 'singles' | 'doubles';
  practiceStartTime: number;
  practiceType?: '単' | '複' | '楽';
}): Session {
  return {
    id: overrides.id,
    config: {
      courtCount: 4,
      targetScore: 21,
      practiceStartTime: overrides.practiceStartTime,
      gym: overrides.gym,
      gameMode: overrides.gameMode,
    },
    createdAt: 0,
    updatedAt: 0,
    practiceType: overrides.practiceType,
  } as Session;
}

// 固定の基準時刻（ローカル日付の境界をまたぐテストのため、日中の時刻を使う）
const DAY1 = new Date(2026, 6, 20, 10, 0, 0).getTime(); // 2026-07-20 10:00
const DAY1_LATER = new Date(2026, 6, 20, 20, 0, 0).getTime(); // 同日 20:00
const DAY2 = new Date(2026, 6, 21, 10, 0, 0).getTime(); // 2026-07-21 10:00

describe('resolvePracticeTypeLabel', () => {
  it('returns session.practiceType when set', () => {
    const s = makeSession({ id: 's1', practiceStartTime: DAY1, practiceType: '楽' });
    expect(resolvePracticeTypeLabel(s)).toBe('楽');
  });

  it('falls back to 単 for singles gameMode when practiceType is unset', () => {
    const s = makeSession({ id: 's1', practiceStartTime: DAY1, gameMode: 'singles' });
    expect(resolvePracticeTypeLabel(s)).toBe('単');
  });

  it('falls back to 複 for doubles gameMode when practiceType is unset', () => {
    const s = makeSession({ id: 's1', practiceStartTime: DAY1, gameMode: 'doubles' });
    expect(resolvePracticeTypeLabel(s)).toBe('複');
  });

  it('falls back to 不明 when neither practiceType nor gameMode is set', () => {
    const s = makeSession({ id: 's1', practiceStartTime: DAY1 });
    expect(resolvePracticeTypeLabel(s)).toBe('不明');
  });
});

describe('startOfDay', () => {
  it('returns the local midnight timestamp for a given time', () => {
    const expected = new Date(2026, 6, 20, 0, 0, 0, 0).getTime();
    expect(startOfDay(DAY1)).toBe(expected);
  });

  it('maps two times on the same local day to the same bucket', () => {
    expect(startOfDay(DAY1)).toBe(startOfDay(DAY1_LATER));
  });

  it('maps times on different local days to different buckets', () => {
    expect(startOfDay(DAY1)).not.toBe(startOfDay(DAY2));
  });
});

describe('deriveFilterOptions', () => {
  it('derives distinct gyms, practice types, and ascending days', () => {
    const sessions = [
      makeSession({ id: 's1', gym: '目白', gameMode: 'doubles', practiceStartTime: DAY2 }),
      makeSession({ id: 's2', gym: '目白', gameMode: 'singles', practiceStartTime: DAY1 }),
      makeSession({ id: 's3', gym: '高松', practiceType: '楽', practiceStartTime: DAY1_LATER }),
    ];
    const options = deriveFilterOptions(sessions);
    expect(options.gyms.sort()).toEqual(['目白', '高松'].sort());
    expect(options.practiceTypes.sort()).toEqual(['単', '複', '楽'].sort());
    expect(options.days).toEqual([startOfDay(DAY1), startOfDay(DAY2)]);
  });

  it('excludes sessions with no gym from the gyms list', () => {
    const sessions = [makeSession({ id: 's1', practiceStartTime: DAY1 })];
    const options = deriveFilterOptions(sessions);
    expect(options.gyms).toEqual([]);
  });

  it('returns empty arrays for an empty session list', () => {
    const options = deriveFilterOptions([]);
    expect(options).toEqual({ gyms: [], practiceTypes: [], days: [] });
  });
});

describe('applySessionFilters', () => {
  const sessions = [
    makeSession({ id: 's1', gym: '目白', gameMode: 'doubles', practiceStartTime: DAY1 }),
    makeSession({ id: 's2', gym: '高松', gameMode: 'singles', practiceStartTime: DAY1 }),
    makeSession({ id: 's3', gym: '目白', practiceType: '楽', practiceStartTime: DAY2 }),
  ];

  it('returns all sessions when all axes are null (no-op)', () => {
    const result = applySessionFilters(sessions, { gym: null, practiceType: null, day: null });
    expect(result).toEqual(sessions);
  });

  it('filters by gym only', () => {
    const result = applySessionFilters(sessions, { gym: '目白', practiceType: null, day: null });
    expect(result.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('filters by practiceType only', () => {
    const result = applySessionFilters(sessions, { gym: null, practiceType: '単', day: null });
    expect(result.map((s) => s.id)).toEqual(['s2']);
  });

  it('filters by day only', () => {
    const result = applySessionFilters(sessions, { gym: null, practiceType: null, day: startOfDay(DAY2) });
    expect(result.map((s) => s.id)).toEqual(['s3']);
  });

  it('combines axes with AND', () => {
    const result = applySessionFilters(sessions, {
      gym: '目白',
      practiceType: '複',
      day: startOfDay(DAY1),
    });
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('returns an empty array when the AND combination matches nothing', () => {
    const result = applySessionFilters(sessions, {
      gym: '目白',
      practiceType: '単',
      day: null,
    });
    expect(result).toEqual([]);
  });
});
