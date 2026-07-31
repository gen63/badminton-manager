import { describe, it, expect } from 'vitest';
import { countByGender, formatGenderBreakdown, genderLabel } from './genderBreakdown';

describe('countByGender', () => {
  it('男・女・未設定を数える', () => {
    const players = [
      { gender: 'M' as const },
      { gender: 'M' as const },
      { gender: 'F' as const },
      {},
    ];
    expect(countByGender(players)).toEqual({ total: 4, male: 2, female: 1, unknown: 1 });
  });

  it('空配列はすべて 0', () => {
    expect(countByGender([])).toEqual({ total: 0, male: 0, female: 0, unknown: 0 });
  });

  it('gender が undefined の人は未設定に入る（男性に寄せない）', () => {
    expect(countByGender([{ gender: undefined }, { gender: 'F' }])).toEqual({
      total: 2,
      male: 0,
      female: 1,
      unknown: 1,
    });
  });
});

describe('formatGenderBreakdown', () => {
  it('未設定がいれば内訳に含める', () => {
    expect(formatGenderBreakdown({ total: 13, male: 8, female: 4, unknown: 1 })).toBe(
      '13人：男8・女4・未設定1'
    );
  });

  it('未設定が 0 人なら項目を省く', () => {
    expect(formatGenderBreakdown({ total: 12, male: 8, female: 4, unknown: 0 })).toBe(
      '12人：男8・女4'
    );
  });
});

describe('genderLabel', () => {
  it('M/F/未設定をラベル化する', () => {
    expect(genderLabel('M')).toBe('男');
    expect(genderLabel('F')).toBe('女');
    expect(genderLabel(undefined)).toBe('未設定');
  });
});
