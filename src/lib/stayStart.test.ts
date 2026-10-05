import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import {
  describeLateChange,
  formatStayOverrideTime,
  lateMinutes,
  parseStayOverrideTime,
  reliefOverrideAt,
  resolveActualStayStart,
  resolveStayStart,
} from './stayStart';

// docs/plans/2026-10-05-stay-start-override.md
const MIN = 60_000;
const NOW = 1_000 * MIN;
const START = NOW - 180 * MIN; // 練習開始は3時間前

const mk = (overrides: Partial<Player> = {}): Player => ({
  id: 'a',
  name: 'a',
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: NOW - 60 * MIN,
  operationStatus: { payment: true, roster: true, checkin: false },
  opsCompletedAt: NOW - 60 * MIN, // 実際の起点は1時間前
  ...overrides,
});

describe('resolveStayStart - みなし開始時刻', () => {
  it('未設定なら従来ルール（opsCompletedAt）', () => {
    expect(resolveStayStart(mk(), START, NOW)).toBe(NOW - 60 * MIN);
  });

  it('実際より早い時刻を設定すると、その時刻が起点になる（遅刻連絡あり）', () => {
    expect(resolveStayStart(mk({ stayStartOverrideAt: NOW - 150 * MIN }), START, NOW)).toBe(NOW - 150 * MIN);
  });

  it('実際より遅い時刻を設定すると、その時刻が起点になる（体調不良など）', () => {
    expect(resolveStayStart(mk({ stayStartOverrideAt: NOW - 20 * MIN }), START, NOW)).toBe(NOW - 20 * MIN);
  });

  it('練習開始より前の値は練習開始時刻で頭打ち', () => {
    expect(resolveStayStart(mk({ stayStartOverrideAt: START - 60 * MIN }), START, NOW)).toBe(START);
  });

  it('未来の値は now で頭打ち（滞在0）', () => {
    expect(resolveStayStart(mk({ stayStartOverrideAt: NOW + 30 * MIN }), START, NOW)).toBe(NOW);
  });

  it('会費・名簿が未完了なら設定があっても now（滞在0）', () => {
    const p = mk({
      operationStatus: { payment: true, roster: false, checkin: false },
      opsCompletedAt: undefined,
      stayStartOverrideAt: NOW - 150 * MIN,
    });
    expect(resolveStayStart(p, START, NOW)).toBe(NOW);
  });

  it('opsCompletedAt がない既存データでも設定が優先される', () => {
    const p = mk({ opsCompletedAt: undefined, stayStartOverrideAt: NOW - 100 * MIN });
    expect(resolveStayStart(p, START, NOW)).toBe(NOW - 100 * MIN);
  });
});

describe('formatStayOverrideTime / parseStayOverrideTime', () => {
  const practiceStart = new Date(2026, 9, 5, 18, 0, 0, 0).getTime();

  it('未設定は空文字', () => {
    expect(formatStayOverrideTime(undefined)).toBe('');
  });

  it('練習日の日付と組み合わせて往復できる', () => {
    const ms = parseStayOverrideTime('19:05', practiceStart);
    expect(ms).toBe(new Date(2026, 9, 5, 19, 5, 0, 0).getTime());
    expect(formatStayOverrideTime(ms!)).toBe('19:05');
  });

  it('練習開始時刻が未設定なら fallbackNow の日付を使う', () => {
    const fallback = new Date(2026, 0, 2, 10, 0).getTime();
    expect(parseStayOverrideTime('09:30', 0, fallback)).toBe(new Date(2026, 0, 2, 9, 30).getTime());
  });

  it('空・不正な形式は null', () => {
    expect(parseStayOverrideTime('', practiceStart)).toBeNull();
    expect(parseStayOverrideTime('25:00', practiceStart)).toBeNull();
    expect(parseStayOverrideTime('abc', practiceStart)).toBeNull();
  });
});

describe('resolveActualStayStart', () => {
  it('みなし開始時刻を無視して従来ルールの起点を返す', () => {
    expect(resolveActualStayStart(mk({ stayStartOverrideAt: NOW - 150 * MIN }), START, NOW)).toBe(NOW - 60 * MIN);
  });
  it('練習開始より前の完了は練習開始で頭打ち', () => {
    expect(resolveActualStayStart(mk({ opsCompletedAt: START - 10 * MIN }), START, NOW)).toBe(START);
  });
  it('opsCompletedAt がなければ activatedAt', () => {
    expect(resolveActualStayStart(mk({ opsCompletedAt: undefined, activatedAt: NOW - 30 * MIN }), START, NOW)).toBe(NOW - 30 * MIN);
  });
  it('会費・名簿が未完了なら null（未到着）', () => {
    const p = mk({ operationStatus: { payment: false, roster: true, checkin: false } });
    expect(resolveActualStayStart(p, START, NOW)).toBeNull();
  });
});

describe('lateMinutes', () => {
  it('練習開始からの分（四捨五入）', () => {
    expect(lateMinutes(START + 40 * MIN, START)).toBe(40);
    expect(lateMinutes(START + 40 * MIN + 31_000, START)).toBe(41);
    expect(lateMinutes(START + 40 * MIN + 29_000, START)).toBe(40);
  });
  it('開始前・定刻は 0', () => {
    expect(lateMinutes(START, START)).toBe(0);
    expect(lateMinutes(START - 10 * MIN, START)).toBe(0);
  });
});

describe('reliefOverrideAt', () => {
  const actual = START + 40 * MIN; // 40分遅刻
  it('1/2 なら遅刻20分のみなし時刻', () => {
    expect(reliefOverrideAt(actual, START, 1 / 2)).toBe(START + 20 * MIN);
  });
  it('1/3 は分単位で四捨五入（40/3=13.3 → 13分）', () => {
    expect(reliefOverrideAt(actual, START, 1 / 3)).toBe(START + 13 * MIN);
    expect(reliefOverrideAt(START + 50 * MIN, START, 1 / 3)).toBe(START + 17 * MIN);
  });
  it('0 なら練習開始（遅刻なしとみなす）', () => {
    expect(reliefOverrideAt(actual, START, 0)).toBe(START);
  });
  it('遅刻していなければ練習開始', () => {
    expect(reliefOverrideAt(START, START, 1 / 2)).toBe(START);
  });
});

describe('describeLateChange', () => {
  it('実際のみ', () => {
    expect(describeLateChange(40, null)).toBe('遅刻 40分');
    expect(describeLateChange(0, null)).toBe('遅刻なし');
  });
  it('救済で短くなる', () => {
    expect(describeLateChange(40, 20)).toBe('遅刻 40分 → 20分（-20分）');
  });
  it('みなしの方が遅い（体調不良など）', () => {
    expect(describeLateChange(0, 30)).toBe('遅刻 0分 → 30分（+30分）');
  });
  it('変化なし', () => {
    expect(describeLateChange(15, 15)).toBe('遅刻 15分 → 15分（±0分）');
  });
  it('未到着はみなし側だけ / どちらもなければ空', () => {
    expect(describeLateChange(null, 20)).toBe('みなし遅刻 20分');
    expect(describeLateChange(null, null)).toBe('');
  });
});
