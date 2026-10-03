import { describe, it, expect } from 'vitest';
import { getLateBalanceAutoOnTime } from './lateBalanceAutoOn';

const MIN = 60 * 1000;

describe('getLateBalanceAutoOnTime', () => {
  it('終了時刻があれば終了の60分前', () => {
    expect(getLateBalanceAutoOnTime({ practiceStartTime: 0, practiceEndTime: 150 * MIN })).toBe(90 * MIN);
  });
  it('終了時刻が無ければ開始+120分', () => {
    expect(getLateBalanceAutoOnTime({ practiceStartTime: 1000 })).toBe(1000 + 120 * MIN);
  });
  it('開始も終了も無ければ null', () => {
    expect(getLateBalanceAutoOnTime({})).toBeNull();
  });
  it('終了時刻のみでも算出できる', () => {
    expect(getLateBalanceAutoOnTime({ practiceEndTime: 100 * MIN })).toBe(40 * MIN);
  });
});
