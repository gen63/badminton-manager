import { describe, it, expect } from 'vitest';
import { cn, formatDate, formatTime, formatDuration, generateSessionId } from './utils';

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
