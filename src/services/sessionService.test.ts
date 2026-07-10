import { describe, it, expect, vi } from 'vitest';

// Firebase 未設定環境でも import できるように db をモック
vi.mock('../lib/firebase', () => ({
  db: null,
}));

import { computeDerivedIncomeTotal } from './sessionService';
import type { Player } from '../types/player';
import type { Session } from '../types/session';

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
  ...overrides,
});

/** 支払い済みプレイヤーを生成するヘルパー */
const paidPlayer = (
  id: string,
  paymentAmount: number,
  overrides: Partial<Player> = {},
): Player =>
  makePlayer(id, {
    operationStatus: { payment: true, roster: false, checkin: false },
    paymentAmount,
    ...overrides,
  });

const makeAccounting = (
  overrides: Partial<NonNullable<Session['accounting']>> = {},
): NonNullable<Session['accounting']> => ({
  exemptCount: 1,
  maleCount: 4,
  femaleCount: 2,
  maleFee: 800,
  femaleFee: 600,
  gymCost: 900,
  shuttlePrice: 480,
  shuttleCount: 0,
  matchCount: 0,
  practiceType: '複',
  ...overrides,
});

describe('computeDerivedIncomeTotal', () => {
  // base: maleTotal = 4×800 = 3200, femaleTotal = 2×600 = 1200 → gross 4400

  it('accounting 未設定なら undefined を返す', () => {
    expect(computeDerivedIncomeTotal(undefined, [])).toBeUndefined();
  });

  it('支払い差額がなければ男女会費合計を返す', () => {
    const players = [paidPlayer('a', 800), paidPlayer('b', 600, { gender: 'F' })];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400);
  });

  it('標準会費より少ない支払いは運営協力割引として差し引く', () => {
    // 男性が 800 のところ 600 支払い → discount 200
    const players = [paidPlayer('a', 600)];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400 - 200);
  });

  it('標準会費より多い支払いは寄付として加算する', () => {
    // 男性が 800 のところ 1000 支払い → donation 200
    const players = [paidPlayer('a', 1000)];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400 + 200);
  });

  it('discount と donation の併存時は両方を反映する', () => {
    const players = [
      paidPlayer('a', 500), // 男 800 → discount 300
      paidPlayer('b', 900, { gender: 'F' }), // 女 600 → donation 300
      paidPlayer('c', 1300), // 男 800 → donation 500
    ];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400 - 300 + 300 + 500);
  });

  it('女性は femaleFee、性別未設定は maleFee を標準会費とする', () => {
    const players = [
      paidPlayer('a', 700, { gender: 'F' }), // 女 600 → donation 100
      paidPlayer('b', 700), // 性別未設定 → 男 800 → discount 100
    ];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400 + 100 - 100);
  });

  it('paymentAmount = 0（免除）と未払いプレイヤーは対象外', () => {
    const players = [
      paidPlayer('a', 0), // 免除 → 差額計算しない
      makePlayer('b', { paymentAmount: 1000 }), // payment フラグなし → 対象外
      makePlayer('c'),
    ];
    expect(computeDerivedIncomeTotal(makeAccounting(), players)).toBe(4400);
  });

  it('otherAmount がプラスのときは加算する', () => {
    expect(
      computeDerivedIncomeTotal(makeAccounting({ otherAmount: 400 }), []),
    ).toBe(4400 + 400);
  });

  it('otherAmount がマイナスのときは収入に含めない（支出扱い）', () => {
    expect(
      computeDerivedIncomeTotal(makeAccounting({ otherAmount: -400 }), []),
    ).toBe(4400);
  });
});
