import { describe, it, expect, vi } from 'vitest';
import { cn, formatDate, formatTime, formatDuration, generateSessionId, copyToClipboard, parsePlayerInput, getRecommendedCourtCount, getAssignmentGate, buildSessionUrl } from './utils';

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

// --- 一括配置強制モード（3状態ゲート）関連のテスト -------------------------

describe('getAssignmentGate', () => {
  it('forceBulkAssignment が false なら常に free', () => {
    expect(getAssignmentGate(false, 1, 1, 0)).toBe('free');
    expect(getAssignmentGate(false, 0, 3, 5)).toBe('free');
    expect(getAssignmentGate(false, 2, 1, 4)).toBe('free');
  });

  it('空きコート0（配置対象なし）は free', () => {
    expect(getAssignmentGate(true, 3, 0, 0)).toBe('free');
  });

  describe('検証ケース: 3コート13人', () => {
    it('1面空き → waiting（プール待機1+終了4=5人）', () => {
      // occupied=2, empty=1, waiting=13-2*4=5, thin: 5-4=1<=2
      expect(getAssignmentGate(true, 2, 1, 5)).toBe('waiting');
    });

    it('2面空き → bulkOnly（プール待機1+終了8=9人→8人配置）', () => {
      // occupied=1, empty=2, waiting=13-1*4=9, thin: 9-8=1<=2
      expect(getAssignmentGate(true, 1, 2, 9)).toBe('bulkOnly');
    });
  });

  describe('検証ケース: 2コート10人', () => {
    it('1面空き → waiting', () => {
      // occupied=1, empty=1, waiting=10-4=6, thin: 6-4=2<=2
      expect(getAssignmentGate(true, 1, 1, 6)).toBe('waiting');
    });

    it('2面空き → bulkOnly', () => {
      // occupied=0, empty=2, waiting=10, thin: 10-8=2<=2
      expect(getAssignmentGate(true, 0, 2, 10)).toBe('bulkOnly');
    });
  });

  describe('検証ケース: 2コート12人（両方 free）', () => {
    it('1面空き → free（十分厚い）', () => {
      // occupied=1, empty=1, waiting=12-4=8, thin: 8-4=4>2
      expect(getAssignmentGate(true, 1, 1, 8)).toBe('free');
    });

    it('2面空き → free', () => {
      // occupied=0, empty=2, waiting=12, thin: 12-8=4>2
      expect(getAssignmentGate(true, 0, 2, 12)).toBe('free');
    });
  });

  it('検証ケース: 3コート15人、1面空きで待機7人 → free', () => {
    // occupied=2, empty=1, waiting=7, thin: 7-4=3>2
    expect(getAssignmentGate(true, 2, 1, 7)).toBe('free');
  });

  it('検証ケース: 1コートセッション（emptyCourts===1 && occupiedCourts===0）は free', () => {
    // 待つ相手がいない。thin であっても free。
    expect(getAssignmentGate(true, 0, 1, 0)).toBe('free');
    expect(getAssignmentGate(true, 0, 1, 2)).toBe('free');
  });

  it('検証ケース: forceBulkAssignment=false は常に free', () => {
    expect(getAssignmentGate(false, 2, 1, 5)).toBe('free');
    expect(getAssignmentGate(false, 1, 2, 9)).toBe('free');
  });

  it('3コート全空き（thin なら bulkOnly、旧エッジケース除外は廃止）', () => {
    // occupied=0, empty=3, waiting=10, thin: 10-12=-2<=2
    expect(getAssignmentGate(true, 0, 3, 10)).toBe('bulkOnly');
  });

  it('停止性: 10人2コート両面終了でも emptyCourts=2 は bulkOnly（永久ブロックしない）', () => {
    // occupied=0, empty=2, waiting=10, thin: 10-8=2<=2
    expect(getAssignmentGate(true, 0, 2, 10)).toBe('bulkOnly');
  });

  it('playersPerCourt / baseThreshold のカスタム値を反映する（シングルス想定）', () => {
    // playersPerCourt=2, baseThreshold=2: occupied=1,empty=1,waiting=3, thin: 3-2=1<=2
    expect(getAssignmentGate(true, 1, 1, 3, 2, 2)).toBe('waiting');
    // waiting=5, thin: 5-2=3>2 -> free
    expect(getAssignmentGate(true, 1, 1, 5, 2, 2)).toBe('free');
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

  it('小数のレーティングを切り捨てずにパースする', () => {
    // tmp シートの skill は小数2桁。parseInt だと 39.68 → 39 になっていた
    expect(parsePlayerInput('しょう\tM\t39.68')).toEqual({ name: 'しょう', rating: 39.68, gender: 'M' });
    expect(parsePlayerInput('うっちー 27.2 F')).toEqual({ name: 'うっちー', rating: 27.2, gender: 'F' });
  });

  it('レート欄が空でも名前と性別をパースする', () => {
    expect(parsePlayerInput('外部まや\tF\t')).toEqual({ name: '外部まや', gender: 'F' });
  });

  it('空行はnullを返す', () => {
    expect(parsePlayerInput('')).toBe(null);
    expect(parsePlayerInput('   ')).toBe(null);
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

describe('buildSessionUrl', () => {
  it('base 付きの URL を組み立てる', () => {
    expect(buildSessionUrl('https://gen63.github.io', '/badminton-manager/', 'ABC123')).toBe(
      'https://gen63.github.io/badminton-manager/session/ABC123',
    );
  });

  it('base のスラッシュ有無に関わらず同じ結果になる', () => {
    const expected = 'https://example.com/app/session/XYZ789';
    expect(buildSessionUrl('https://example.com', 'app', 'XYZ789')).toBe(expected);
    expect(buildSessionUrl('https://example.com', '/app', 'XYZ789')).toBe(expected);
    expect(buildSessionUrl('https://example.com', 'app/', 'XYZ789')).toBe(expected);
    expect(buildSessionUrl('https://example.com', '/app/', 'XYZ789')).toBe(expected);
  });

  it('base がルート（/）ならセグメントを足さない', () => {
    expect(buildSessionUrl('http://localhost:5173', '/', 'ABC123')).toBe(
      'http://localhost:5173/session/ABC123',
    );
  });

  it('origin の末尾スラッシュを重複させない', () => {
    expect(buildSessionUrl('http://localhost:5173/', '/app/', 'ABC123')).toBe(
      'http://localhost:5173/app/session/ABC123',
    );
  });
});
