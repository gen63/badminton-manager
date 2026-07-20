import { describe, it, expect } from 'vitest';
import type { Session } from '../types/session';
import {
  resolvePracticeTypeLabel,
  startOfMonth,
  formatMonthLabel,
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

// 固定の基準時刻（ローカル月の境界をまたぐテストのため、月内の異なる日を使う）
const MONTH1_A = new Date(2026, 6, 20, 10, 0, 0).getTime(); // 2026-07-20 10:00
const MONTH1_B = new Date(2026, 6, 5, 20, 0, 0).getTime(); // 2026-07-05 20:00（同月・別日）
const MONTH2 = new Date(2026, 7, 3, 10, 0, 0).getTime(); // 2026-08-03 10:00（翌月）

describe('resolvePracticeTypeLabel', () => {
  it('returns session.practiceType when set', () => {
    const s = makeSession({ id: 's1', practiceStartTime: MONTH1_A, practiceType: '楽' });
    expect(resolvePracticeTypeLabel(s)).toBe('楽');
  });

  it('falls back to 単 for singles gameMode when practiceType is unset', () => {
    const s = makeSession({ id: 's1', practiceStartTime: MONTH1_A, gameMode: 'singles' });
    expect(resolvePracticeTypeLabel(s)).toBe('単');
  });

  it('falls back to 複 for doubles gameMode when practiceType is unset', () => {
    const s = makeSession({ id: 's1', practiceStartTime: MONTH1_A, gameMode: 'doubles' });
    expect(resolvePracticeTypeLabel(s)).toBe('複');
  });

  it('falls back to 不明 when neither practiceType nor gameMode is set', () => {
    const s = makeSession({ id: 's1', practiceStartTime: MONTH1_A });
    expect(resolvePracticeTypeLabel(s)).toBe('不明');
  });
});

describe('startOfMonth', () => {
  it('returns the local first-of-month midnight timestamp for a given time', () => {
    const expected = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();
    expect(startOfMonth(MONTH1_A)).toBe(expected);
  });

  it('maps two times in the same local month to the same bucket', () => {
    expect(startOfMonth(MONTH1_A)).toBe(startOfMonth(MONTH1_B));
  });

  it('maps times in different local months to different buckets', () => {
    expect(startOfMonth(MONTH1_A)).not.toBe(startOfMonth(MONTH2));
  });
});

describe('formatMonthLabel', () => {
  it('formats a month-start timestamp as "YYYY年M月"', () => {
    expect(formatMonthLabel(startOfMonth(MONTH1_A))).toBe('2026年7月');
  });

  it('formats a different month correctly', () => {
    expect(formatMonthLabel(startOfMonth(MONTH2))).toBe('2026年8月');
  });
});

describe('deriveFilterOptions', () => {
  it('derives distinct gyms, practice types, and ascending months', () => {
    const sessions = [
      makeSession({ id: 's1', gym: '目白', gameMode: 'doubles', practiceStartTime: MONTH2 }),
      makeSession({ id: 's2', gym: '目白', gameMode: 'singles', practiceStartTime: MONTH1_A }),
      makeSession({ id: 's3', gym: '高松', practiceType: '楽', practiceStartTime: MONTH1_B }),
    ];
    const options = deriveFilterOptions(sessions);
    expect(options.gyms.sort()).toEqual(['目白', '高松'].sort());
    expect(options.practiceTypes.sort()).toEqual(['単', '複', '楽'].sort());
    expect(options.months).toEqual([startOfMonth(MONTH1_A), startOfMonth(MONTH2)]);
  });

  it('excludes sessions with no gym from the gyms list', () => {
    const sessions = [makeSession({ id: 's1', practiceStartTime: MONTH1_A })];
    const options = deriveFilterOptions(sessions);
    expect(options.gyms).toEqual([]);
  });

  it('returns empty arrays for an empty session list', () => {
    const options = deriveFilterOptions([]);
    expect(options).toEqual({ gyms: [], practiceTypes: [], months: [] });
  });
});

describe('applySessionFilters', () => {
  const sessions = [
    makeSession({ id: 's1', gym: '目白', gameMode: 'doubles', practiceStartTime: MONTH1_A }),
    makeSession({ id: 's2', gym: '高松', gameMode: 'singles', practiceStartTime: MONTH1_A }),
    makeSession({ id: 's3', gym: '目白', practiceType: '楽', practiceStartTime: MONTH2 }),
  ];

  it('returns all sessions when all axes are null (no-op)', () => {
    const result = applySessionFilters(sessions, { gym: null, practiceType: null, month: null });
    expect(result).toEqual(sessions);
  });

  it('filters by gym only', () => {
    const result = applySessionFilters(sessions, { gym: '目白', practiceType: null, month: null });
    expect(result.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('filters by practiceType only', () => {
    const result = applySessionFilters(sessions, { gym: null, practiceType: '単', month: null });
    expect(result.map((s) => s.id)).toEqual(['s2']);
  });

  it('filters by month only', () => {
    const result = applySessionFilters(sessions, {
      gym: null,
      practiceType: null,
      month: startOfMonth(MONTH2),
    });
    expect(result.map((s) => s.id)).toEqual(['s3']);
  });

  it('combines axes with AND', () => {
    const result = applySessionFilters(sessions, {
      gym: '目白',
      practiceType: '複',
      month: startOfMonth(MONTH1_A),
    });
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('returns an empty array when the AND combination matches nothing', () => {
    const result = applySessionFilters(sessions, {
      gym: '目白',
      practiceType: '単',
      month: null,
    });
    expect(result).toEqual([]);
  });
});
