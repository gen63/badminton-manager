import { describe, it, expect } from 'vitest';
import { averagePlayerRating } from './ratingSummary';
import type { Player } from '../types/player';

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
  ...overrides,
});

describe('averagePlayerRating', () => {
  it('レート登録済みプレイヤーの平均を返す', () => {
    const players = [
      makePlayer('a', { rating: 1400 }),
      makePlayer('b', { rating: 1500 }),
      makePlayer('c', { rating: 1600 }),
    ];
    expect(averagePlayerRating(players)).toBe(1500);
  });

  it('未レート（未設定 / 0）は母集団から除外する', () => {
    const players = [
      makePlayer('a', { rating: 1400 }),
      makePlayer('b', { rating: 0 }),
      makePlayer('c'),
      makePlayer('d', { rating: 1600 }),
    ];
    expect(averagePlayerRating(players)).toBe(1500);
  });

  it('試合をしていないプレイヤーも母集団に含む（開催前でも出す）', () => {
    const players = [
      makePlayer('a', { rating: 1000, gamesPlayed: 0 }),
      makePlayer('b', { rating: 2000, gamesPlayed: 0 }),
    ];
    expect(averagePlayerRating(players)).toBe(1500);
  });

  it('割り切れない平均は小数第1位に丸める', () => {
    const players = [
      makePlayer('a', { rating: 10 }),
      makePlayer('b', { rating: 11 }),
      makePlayer('c', { rating: 11 }),
    ];
    // 32 / 3 = 10.666... → 10.7
    expect(averagePlayerRating(players)).toBe(10.7);
  });

  it('レート登録済みが0人なら undefined', () => {
    expect(averagePlayerRating([makePlayer('a'), makePlayer('b', { rating: 0 })])).toBeUndefined();
  });

  it('空配列なら undefined', () => {
    expect(averagePlayerRating([])).toBeUndefined();
  });
});
