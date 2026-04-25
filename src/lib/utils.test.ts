import { describe, it, expect, vi } from 'vitest';
import { cn, formatDate, formatTime, formatDuration, generateSessionId, copyToClipboard, parsePlayerInput, getRecommendedCourtCount, shouldBlockForDiversity, sortPairByStrength, sortPairWithIndex } from './utils';
import type { Player } from '../types/player';

describe('cn', () => {
  it('単一のクラス名を返す', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('複数のクラス名をマージする', () => {
    expect(cn('p-4', 'm-2')).toBe('p-4 m-2');
  });

  it('条件付きクラスを処理する', () => {
    const isActive = true;
    const isHidden = false;
    expect(cn('base', isActive && 'active', isHidden && 'hidden')).toBe('base active');
  });

  it('Tailwindの競合するクラスをマージする', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});

describe('formatDate', () => {
  it('Dateオブジェクトを日本語形式でフォーマットする', () => {
    const date = new Date('2026-02-04T10:30:00');
    const result = formatDate(date);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/02/);
    expect(result).toMatch(/04/);
  });

  it('タイムスタンプを日本語形式でフォーマットする', () => {
    const timestamp = new Date('2026-02-04T10:30:00').getTime();
    const result = formatDate(timestamp);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/02/);
    expect(result).toMatch(/04/);
  });
});

describe('formatTime', () => {
  it('Dateオブジェクトを時刻形式でフォーマットする', () => {
    const date = new Date('2026-02-04T10:30:00');
    const result = formatTime(date);
    expect(result).toMatch(/10/);
    expect(result).toMatch(/30/);
  });

  it('タイムスタンプを時刻形式でフォーマットする', () => {
    const timestamp = new Date('2026-02-04T14:45:00').getTime();
    const result = formatTime(timestamp);
    expect(result).toMatch(/14/);
    expect(result).toMatch(/45/);
  });
});

describe('formatDuration', () => {
  it('ミリ秒の差を分に変換する', () => {
    const start = 0;
    const end = 60000; // 1分
    expect(formatDuration(start, end)).toBe('1分');
  });

  it('複数分の期間を正しくフォーマットする', () => {
    const start = 0;
    const end = 300000; // 5分
    expect(formatDuration(start, end)).toBe('5分');
  });

  it('端数を切り捨てる', () => {
    const start = 0;
    const end = 90000; // 1.5分
    expect(formatDuration(start, end)).toBe('1分');
  });
});

describe('generateSessionId', () => {
  it('session-プレフィックスで始まるIDを生成する', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^session-/);
  });

  it('タイムスタンプを含むIDを生成する', () => {
    const id = generateSessionId();
    const parts = id.split('-');
    expect(parts.length).toBe(3);
    expect(Number(parts[1])).not.toBeNaN();
  });

  it('毎回異なるIDを生成する', () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();
    expect(id1).not.toBe(id2);
  });
});

// --- 多様性優先関連のテスト -----------------------------------------------

describe('shouldBlockForDiversity', () => {
  it('returns false when prioritizeDiversity is off', () => {
    expect(
      shouldBlockForDiversity(false, 1, 1, 0, 4, 2)
    ).toBe(false);
  });

  it('shows recommendation even when no empty courts (预告として)', () => {
    // 空きコート0、待機2人 → 仮に1コート空くと余り-2 <= 2 → 推奨表示
    expect(
      shouldBlockForDiversity(true, 2, 0, 2, 8, 2)
    ).toBe(true);

    // 空きコート0、待機10人 → 仮に1コート空くと余り6 > 2 → 推奨なし
    expect(
      shouldBlockForDiversity(true, 2, 0, 10, 16, 2)
    ).toBe(false);
  });

  it('blocks when all courts empty but players insufficient for diversity', () => {
    // 2コート全空き、8人 -> 余り0 <= 2 -> 推奨表示
    expect(
      shouldBlockForDiversity(true, 0, 2, 8, 8, 2)
    ).toBe(true);

    // 2コート全空き、10人 -> 余り2 <= 2 -> 推奨表示
    expect(
      shouldBlockForDiversity(true, 0, 2, 10, 10, 2)
    ).toBe(true);

    // 2コート全空き、11人 -> 余り3 > 2 -> 推奨なし
    expect(
      shouldBlockForDiversity(true, 0, 2, 11, 11, 2)
    ).toBe(false);
  });

  it('edge case: 3コート全空きは推奨なし', () => {
    // 3コート全空き、10人 -> エッジケース -> 推奨なし
    expect(
      shouldBlockForDiversity(true, 0, 3, 10, 10, 2)
    ).toBe(false);

    // 3コート全空き、14人 -> エッジケース -> 推奨なし
    expect(
      shouldBlockForDiversity(true, 0, 3, 14, 14, 2)
    ).toBe(false);

    // 3コート（1使用中+2空き）、10人 -> 余り2 <= 2 -> 推奨表示
    expect(
      shouldBlockForDiversity(true, 1, 2, 10, 14, 2)
    ).toBe(true);
  });

  it('blocks when remaining after assignment <= base threshold (2)', () => {
    // 1 empty, waiting 4 -> remaining 0 <= 2 -> block
    expect(
      shouldBlockForDiversity(true, 1, 1, 4, 8, 2)
    ).toBe(true);

    // 1 empty, waiting 5 -> remaining 1 <= 2 -> block
    expect(
      shouldBlockForDiversity(true, 1, 1, 5, 9, 2)
    ).toBe(true);

    // 1 empty, waiting 6 -> remaining 2 <= 2 -> block
    expect(
      shouldBlockForDiversity(true, 1, 1, 6, 10, 2)
    ).toBe(true);

    // 1 empty, waiting 7 -> remaining 3 > 2 -> no block (元の問題が解決)
    expect(
      shouldBlockForDiversity(true, 1, 1, 7, 11, 2)
    ).toBe(false);
  });

  it('連続モード用の高いthreshold (7) でもテスト', () => {
    // 1 empty, waiting 10 -> remaining 6 <= 7 -> block
    expect(
      shouldBlockForDiversity(true, 1, 1, 10, 14, 7)
    ).toBe(true);

    // 1 empty, waiting 12 -> remaining 8 > 7 -> no block
    expect(
      shouldBlockForDiversity(true, 1, 1, 12, 16, 7)
    ).toBe(false);
  });
});

describe('copyToClipboard', () => {
  it('クリップボードにテキストをコピーする', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
    });

    const result = await copyToClipboard('test text');
    expect(result).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith('test text');
  });

  it('クリップボードコピーに失敗した場合falseを返す', async () => {
    const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard error'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
    });

    const result = await copyToClipboard('test text');
    expect(result).toBe(false);
  });
});

describe('parsePlayerInput', () => {
  it('名前のみのパース', () => {
    expect(parsePlayerInput('Alice')).toEqual({ name: 'Alice' });
  });

  it('名前とレーティングのパース', () => {
    expect(parsePlayerInput('Alice 1500')).toEqual({ name: 'Alice', rating: 1500 });
  });

  it('名前と性別のパース', () => {
    expect(parsePlayerInput('Alice M')).toEqual({ name: 'Alice', gender: 'M' });
    expect(parsePlayerInput('Alice 女')).toEqual({ name: 'Alice', gender: 'F' });
  });

  it('名前と性別のパース（スペース複数）', () => {
    expect(parsePlayerInput('Alice  M')).toEqual({ name: 'Alice', gender: 'M' });
  });

  it('名前、レーティング、性別のパース', () => {
    expect(parsePlayerInput('Alice 1500 M')).toEqual({ name: 'Alice', rating: 1500, gender: 'M' });
  });

  it('タブ区切りのパース', () => {
    expect(parsePlayerInput('Alice\t1500\tM')).toEqual({ name: 'Alice', rating: 1500, gender: 'M' });
  });

  it('空行はnullを返す', () => {
    expect(parsePlayerInput('')).toBe(null);
    expect(parsePlayerInput('   ')).toBe(null);
  });
});

describe('sortPairByStrength', () => {
  const makePlayer = (id: string, name: string, rating?: number): Player => ({
    id,
    name,
    rating,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: 0,
  });

  it('高レーティング選手が先頭に来る', () => {
    const players = [
      makePlayer('p1', 'Alice', 1500),
      makePlayer('p2', 'Bob', 1700),
    ];
    expect(sortPairByStrength(['p1', 'p2'], players)).toEqual(['p2', 'p1']);
    expect(sortPairByStrength(['p2', 'p1'], players)).toEqual(['p2', 'p1']);
  });

  it('同レーティングの場合は名前昇順', () => {
    const players = [
      makePlayer('p1', '佐藤', 1500),
      makePlayer('p2', '伊藤', 1500),
    ];
    // 伊藤 < 佐藤
    expect(sortPairByStrength(['p1', 'p2'], players)).toEqual(['p2', 'p1']);
  });

  it('レーティング未設定は0扱い（最弱）', () => {
    const players = [
      makePlayer('p1', 'Alice', 1500),
      makePlayer('p2', 'Bob'), // 未設定
    ];
    expect(sortPairByStrength(['p1', 'p2'], players)).toEqual(['p1', 'p2']);
    expect(sortPairByStrength(['p2', 'p1'], players)).toEqual(['p1', 'p2']);
  });

  it('シングルス（空文字ID）は末尾', () => {
    const players = [makePlayer('p1', 'Alice', 1500)];
    expect(sortPairByStrength(['p1', ''], players)).toEqual(['p1', '']);
    expect(sortPairByStrength(['', 'p1'], players)).toEqual(['p1', '']);
  });

  it('見つからないIDは末尾', () => {
    const players = [makePlayer('p1', 'Alice', 1500)];
    expect(sortPairByStrength(['unknown', 'p1'], players)).toEqual(['p1', 'unknown']);
  });

  it('元のペアを破壊しない', () => {
    const players = [
      makePlayer('p1', 'Alice', 1500),
      makePlayer('p2', 'Bob', 1700),
    ];
    const original: [string, string] = ['p1', 'p2'];
    sortPairByStrength(original, players);
    expect(original).toEqual(['p1', 'p2']);
  });
});

describe('sortPairWithIndex', () => {
  const makePlayer = (id: string, name: string, rating?: number): Player => ({
    id,
    name,
    rating,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: 0,
  });

  it('強い選手が先頭、元の配列インデックスを保持する', () => {
    const players = [
      makePlayer('p1', 'Alice', 1500),
      makePlayer('p2', 'Bob', 1700),
    ];
    expect(sortPairWithIndex(['p1', 'p2'], players)).toEqual([
      { id: 'p2', index: 1 },
      { id: 'p1', index: 0 },
    ]);
  });

  it('既に強い順ならそのまま', () => {
    const players = [
      makePlayer('p1', 'Alice', 1700),
      makePlayer('p2', 'Bob', 1500),
    ];
    expect(sortPairWithIndex(['p1', 'p2'], players)).toEqual([
      { id: 'p1', index: 0 },
      { id: 'p2', index: 1 },
    ]);
  });

  it('シングルス（空文字IDは末尾）でもインデックスは元のまま', () => {
    const players = [makePlayer('p1', 'Alice', 1500)];
    expect(sortPairWithIndex(['p1', ''], players)).toEqual([
      { id: 'p1', index: 0 },
      { id: '', index: 1 },
    ]);
    expect(sortPairWithIndex(['', 'p1'], players)).toEqual([
      { id: 'p1', index: 1 },
      { id: '', index: 0 },
    ]);
  });
});

describe('getRecommendedCourtCount', () => {
  it('参加人数に応じたコート数を推奨する', () => {
    expect(getRecommendedCourtCount(4)).toBe(1); // 4-4=0 <2
    expect(getRecommendedCourtCount(6)).toBe(1); // 6-4=2 >=2
    expect(getRecommendedCourtCount(10)).toBe(2); // 10-8=2 >=2
    expect(getRecommendedCourtCount(14)).toBe(3); // 14-12=2 >=2
    expect(getRecommendedCourtCount(15)).toBe(3); // 15-12=3 >=2
  });

  it('最大コート数を制限する', () => {
    expect(getRecommendedCourtCount(20, 2)).toBe(2); // max 2
  });
});
