import { describe, it, expect } from 'vitest';
import type { Session } from '../types/session';
import {
  resolvePracticeTypeLabel,
  startOfMonth,
  formatMonthLabel,
  deriveFilterOptions,
  applySessionFilters,
  summarizeSessionMedians,
  parseMonthFilterValue,
  isWithinRecentMonths,
  RECENT_MONTHS,
} from './sessionFilters';

function makeSession(overrides: {
  id: string;
  gym?: string;
  gameMode?: 'singles' | 'doubles';
  practiceStartTime: number;
  practiceType?: '単' | '複' | '楽';
  medianGamesPlayed?: number;
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
    medianGamesPlayed: overrides.medianGamesPlayed,
  } as Session;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

describe('isWithinRecentMonths', () => {
  const now = MONTH2;

  it('includes a session inside the 60-day window', () => {
    expect(isWithinRecentMonths(now - 59 * DAY_MS, now)).toBe(true);
  });

  it('includes the exact 60-day boundary', () => {
    expect(isWithinRecentMonths(now - 60 * DAY_MS, now)).toBe(true);
  });

  it('excludes a session older than 60 days', () => {
    expect(isWithinRecentMonths(now - 61 * DAY_MS, now)).toBe(false);
  });

  it('includes future sessions (no upper bound)', () => {
    expect(isWithinRecentMonths(now + 10 * DAY_MS, now)).toBe(true);
  });
});

describe('applySessionFilters (直近2ヶ月)', () => {
  const now = MONTH2;
  const sessions = [
    makeSession({ id: 'future', practiceStartTime: now + 7 * DAY_MS }),
    makeSession({ id: 'recent', practiceStartTime: now - 30 * DAY_MS }),
    makeSession({ id: 'edge', practiceStartTime: now - 60 * DAY_MS }),
    makeSession({ id: 'old', practiceStartTime: now - 61 * DAY_MS }),
  ];

  it('keeps only sessions within the 60-day window plus future ones', () => {
    const result = applySessionFilters(
      sessions,
      { gym: null, practiceType: null, month: RECENT_MONTHS },
      now,
    );
    expect(result.map((s) => s.id)).toEqual(['future', 'recent', 'edge']);
  });

  it('combines the recent window with other axes via AND', () => {
    const withGyms = [
      makeSession({ id: 'a', gym: '目白', practiceStartTime: now - 10 * DAY_MS }),
      makeSession({ id: 'b', gym: '高松', practiceStartTime: now - 10 * DAY_MS }),
      makeSession({ id: 'c', gym: '目白', practiceStartTime: now - 90 * DAY_MS }),
    ];
    const result = applySessionFilters(
      withGyms,
      { gym: '目白', practiceType: null, month: RECENT_MONTHS },
      now,
    );
    expect(result.map((s) => s.id)).toEqual(['a']);
  });

  it('ignores the 60-day window when the month axis is a specific month', () => {
    const result = applySessionFilters(
      sessions,
      { gym: null, practiceType: null, month: startOfMonth(now - 61 * DAY_MS) },
      now,
    );
    // edge(60日前) と old(61日前) は同じ暦月。月を選ぶと 60 日窓は効かず両方残る
    expect(result.map((s) => s.id)).toEqual(['edge', 'old']);
  });
});

describe('parseMonthFilterValue', () => {
  it('maps null and empty string to null (すべて)', () => {
    expect(parseMonthFilterValue(null)).toBeNull();
    expect(parseMonthFilterValue('')).toBeNull();
  });

  it('keeps the recent sentinel as-is', () => {
    expect(parseMonthFilterValue(RECENT_MONTHS)).toBe(RECENT_MONTHS);
  });

  it('parses a month-start timestamp back to a number', () => {
    const month = startOfMonth(MONTH1_A);
    expect(parseMonthFilterValue(String(month))).toBe(month);
  });
});

describe('summarizeSessionMedians', () => {
  it('takes the median across sessions (one data point per session)', () => {
    const sessions = [
      makeSession({ id: 's1', practiceStartTime: MONTH1_A, medianGamesPlayed: 3 }),
      makeSession({ id: 's2', practiceStartTime: MONTH1_A, medianGamesPlayed: 5 }),
      makeSession({ id: 's3', practiceStartTime: MONTH2, medianGamesPlayed: 4 }),
    ];
    expect(summarizeSessionMedians(sessions)).toEqual({ median: 4, sessionCount: 3 });
  });

  it('excludes sessions with no games (undefined / 0)', () => {
    const sessions = [
      makeSession({ id: 's1', practiceStartTime: MONTH1_A }), // 未開催 → undefined
      makeSession({ id: 's2', practiceStartTime: MONTH1_A, medianGamesPlayed: 0 }),
      makeSession({ id: 's3', practiceStartTime: MONTH2, medianGamesPlayed: 6 }),
      makeSession({ id: 's4', practiceStartTime: MONTH2, medianGamesPlayed: 8 }),
    ];
    // 除外後は [6, 8] → 中央値 7、母集団は2開催
    expect(summarizeSessionMedians(sessions)).toEqual({ median: 7, sessionCount: 2 });
  });

  it('rounds the median of medians to one decimal place', () => {
    const sessions = [
      makeSession({ id: 's1', practiceStartTime: MONTH1_A, medianGamesPlayed: 4 }),
      makeSession({ id: 's2', practiceStartTime: MONTH1_A, medianGamesPlayed: 4.5 }),
    ];
    // (4 + 4.5) / 2 = 4.25 → 4.3
    expect(summarizeSessionMedians(sessions)).toEqual({ median: 4.3, sessionCount: 2 });
  });

  it('returns undefined when no session has games', () => {
    const sessions = [
      makeSession({ id: 's1', practiceStartTime: MONTH1_A }),
      makeSession({ id: 's2', practiceStartTime: MONTH2, medianGamesPlayed: 0 }),
    ];
    expect(summarizeSessionMedians(sessions)).toEqual({ median: undefined, sessionCount: 0 });
  });

  it('returns undefined for an empty list', () => {
    expect(summarizeSessionMedians([])).toEqual({ median: undefined, sessionCount: 0 });
  });
});
