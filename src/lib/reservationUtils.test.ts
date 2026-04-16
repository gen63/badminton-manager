import { describe, it, expect } from 'vitest';
import { inferDoublesCategory, getCategoryShortLabel } from './reservationUtils';
import type { Player } from '../types/player';

function makePlayer(id: string, gender?: 'M' | 'F'): Player {
  return {
    id,
    name: `Player${id}`,
    gender,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: 0,
  };
}

describe('inferDoublesCategory', () => {
  const players = [
    makePlayer('m1', 'M'),
    makePlayer('m2', 'M'),
    makePlayer('m3', 'M'),
    makePlayer('m4', 'M'),
    makePlayer('f1', 'F'),
    makePlayer('f2', 'F'),
    makePlayer('f3', 'F'),
    makePlayer('f4', 'F'),
    makePlayer('u1'),         // 性別未設定
  ];

  describe('2人選択', () => {
    it('男性2人 → 男子ダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2'], players)).toBe('男子ダブルス');
    });

    it('女性2人 → 女子ダブルス', () => {
      expect(inferDoublesCategory(['f1', 'f2'], players)).toBe('女子ダブルス');
    });

    it('男女1人ずつ → ミックスダブルス', () => {
      expect(inferDoublesCategory(['m1', 'f1'], players)).toBe('ミックスダブルス');
    });
  });

  describe('3人選択', () => {
    it('男性3人 → 男子ダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2', 'm3'], players)).toBe('男子ダブルス');
    });

    it('女性3人 → 女子ダブルス', () => {
      expect(inferDoublesCategory(['f1', 'f2', 'f3'], players)).toBe('女子ダブルス');
    });

    it('男2女1 → ミックスダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2', 'f1'], players)).toBe('ミックスダブルス');
    });

    it('男1女2 → ミックスダブルス', () => {
      expect(inferDoublesCategory(['m1', 'f1', 'f2'], players)).toBe('ミックスダブルス');
    });
  });

  describe('4人選択', () => {
    it('男性4人 → 男子ダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2', 'm3', 'm4'], players)).toBe('男子ダブルス');
    });

    it('女性4人 → 女子ダブルス', () => {
      expect(inferDoublesCategory(['f1', 'f2', 'f3', 'f4'], players)).toBe('女子ダブルス');
    });

    it('男2女2 → ミックスダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2', 'f1', 'f2'], players)).toBe('ミックスダブルス');
    });

    it('男3女1 → ミックスダブルス', () => {
      expect(inferDoublesCategory(['m1', 'm2', 'm3', 'f1'], players)).toBe('ミックスダブルス');
    });
  });

  describe('エッジケース', () => {
    it('1人 → null（最低2人必要）', () => {
      expect(inferDoublesCategory(['m1'], players)).toBeNull();
    });

    it('0人 → null', () => {
      expect(inferDoublesCategory([], players)).toBeNull();
    });

    it('性別未設定を含む → null', () => {
      expect(inferDoublesCategory(['m1', 'u1'], players)).toBeNull();
    });

    it('存在しないプレイヤーID → null', () => {
      expect(inferDoublesCategory(['m1', 'unknown'], players)).toBeNull();
    });
  });
});

describe('getCategoryShortLabel', () => {
  it('男子ダブルス → ダンダブ', () => {
    expect(getCategoryShortLabel('男子ダブルス')).toBe('ダンダブ');
  });

  it('女子ダブルス → ジョダブ', () => {
    expect(getCategoryShortLabel('女子ダブルス')).toBe('ジョダブ');
  });

  it('ミックスダブルス → ミックス', () => {
    expect(getCategoryShortLabel('ミックスダブルス')).toBe('ミックス');
  });

  it('null → null', () => {
    expect(getCategoryShortLabel(null)).toBeNull();
  });
});
