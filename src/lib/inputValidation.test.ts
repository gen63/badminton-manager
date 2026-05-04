import { describe, it, expect } from 'vitest';
import {
  sanitizePlayerName,
  isValidPlayerName,
  isValidSessionId,
  MAX_PLAYER_NAME_LENGTH,
} from './inputValidation';

describe('sanitizePlayerName', () => {
  it('通常名はそのまま返す', () => {
    expect(sanitizePlayerName('Alice')).toBe('Alice');
    expect(sanitizePlayerName('田中 太郎')).toBe('田中 太郎');
  });

  it('前後 whitespace を除去', () => {
    expect(sanitizePlayerName('  Alice  ')).toBe('Alice');
  });

  it('空文字 / whitespace だけは null', () => {
    expect(sanitizePlayerName('')).toBeNull();
    expect(sanitizePlayerName('   ')).toBeNull();
    expect(sanitizePlayerName('\t\n')).toBeNull();
  });

  it('制御文字を除去', () => {
    expect(sanitizePlayerName('Ali\x00ce')).toBe('Alice');
    expect(sanitizePlayerName('Bob\x07')).toBe('Bob');
    expect(sanitizePlayerName('\x1B[31mNinja\x1B[0m')).toBe('[31mNinja[0m');
  });

  it('zero-width 文字を除去', () => {
    expect(sanitizePlayerName('Ali​ce')).toBe('Alice');
    expect(sanitizePlayerName('﻿Taro')).toBe('Taro');
  });

  it(`${MAX_PLAYER_NAME_LENGTH} 文字超は切り詰め`, () => {
    const long = 'a'.repeat(100);
    const result = sanitizePlayerName(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(MAX_PLAYER_NAME_LENGTH);
  });
});

describe('isValidPlayerName', () => {
  it('空でなければ true', () => {
    expect(isValidPlayerName('Alice')).toBe(true);
  });
  it('whitespace のみは false', () => {
    expect(isValidPlayerName('   ')).toBe(false);
  });
});

describe('isValidSessionId', () => {
  it('6 文字大文字英数字なら true', () => {
    expect(isValidSessionId('ABC123')).toBe(true);
    expect(isValidSessionId('ZZZZZZ')).toBe(true);
    expect(isValidSessionId('000000')).toBe(true);
  });

  it('小文字 / 5 文字以下 / 7 文字以上 / 記号 はすべて false', () => {
    expect(isValidSessionId('abc123')).toBe(false);
    expect(isValidSessionId('ABC12')).toBe(false);
    expect(isValidSessionId('ABC1234')).toBe(false);
    expect(isValidSessionId('ABC-12')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
  });
});
