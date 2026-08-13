import { describe, it, expect } from 'vitest';
import { median, medianGamesPlayed } from './median';
import type { Player } from '../types/player';

/** テスト用プレイヤー生成 */
function makePlayer(id: string, gamesPlayed: number): Player {
  return {
    id,
    name: `Player ${id}`,
    isResting: false,
    gamesPlayed,
    lastPlayedAt: 0,
    activatedAt: 0,
  };
}

describe('median', () => {
  it('奇数個は中央の値', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('偶数個は中間2値の平均（.5 が出る）', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('1人なら本人の値', () => {
    expect(median([7])).toBe(7);
  });

  it('空配列は 0', () => {
    expect(median([])).toBe(0);
  });
});

describe('medianGamesPlayed', () => {
  it('gamesPlayed === 0 のプレイヤーを除外する', () => {
    const players = [
      makePlayer('p1', 0),
      makePlayer('p2', 2),
      makePlayer('p3', 4),
    ];
    // 0試合の p1 を除くと [2, 4] の中央値 3
    expect(medianGamesPlayed(players)).toBe(3);
  });

  it('全員 gamesPlayed === 0 なら undefined', () => {
    const players = [makePlayer('p1', 0), makePlayer('p2', 0)];
    expect(medianGamesPlayed(players)).toBeUndefined();
  });

  it('除外後に偶数個で .5 が出る', () => {
    const players = [
      makePlayer('p1', 0),
      makePlayer('p2', 1),
      makePlayer('p3', 2),
      makePlayer('p4', 3),
      makePlayer('p5', 4),
    ];
    // 0試合の p1 を除くと [1, 2, 3, 4] の中央値 2.5
    expect(medianGamesPlayed(players)).toBe(2.5);
  });
});
