import { describe, it, expect } from 'vitest';
import { pickNameFontSizePx, nameCharCount } from './matchNameFont';

describe('nameCharCount', () => {
  it('サロゲートペアを1文字と数える', () => {
    expect(nameCharCount('よしだひろき')).toBe(6);
    expect(nameCharCount('𠮷田')).toBe(2);
  });
});

describe('pickNameFontSizePx', () => {
  // 分析なし 1行目: 276-6=270 → 14px:19文字 / 12px:22文字 / 11px:24文字
  it('分析なし1行目の境界', () => {
    const o = { hasVsPill: false, hasInsight: false };
    expect(pickNameFontSizePx(19, o)).toBe(14);
    expect(pickNameFontSizePx(20, o)).toBe(12);
    expect(pickNameFontSizePx(22, o)).toBe(12);
    expect(pickNameFontSizePx(23, o)).toBe(11);
    expect(pickNameFontSizePx(99, o)).toBe(11);
  });
  // 分析なし 2行目: 276-44=232 → 14px:16 / 12px:19
  it('分析なし2行目（VSぶん）の境界', () => {
    const o = { hasVsPill: true, hasInsight: false };
    expect(pickNameFontSizePx(16, o)).toBe(14);
    expect(pickNameFontSizePx(17, o)).toBe(12);
    expect(pickNameFontSizePx(19, o)).toBe(12);
    expect(pickNameFontSizePx(20, o)).toBe(11);
  });
  // 分析あり 1行目: 216-6=210 → 14px:15 / 12px:17
  it('分析あり1行目の境界', () => {
    const o = { hasVsPill: false, hasInsight: true };
    expect(pickNameFontSizePx(15, o)).toBe(14);
    expect(pickNameFontSizePx(16, o)).toBe(12);
    expect(pickNameFontSizePx(17, o)).toBe(12);
    expect(pickNameFontSizePx(18, o)).toBe(11);
  });
  // 分析あり 2行目: 216-44=172 → 14px:12 / 12px:14
  it('分析あり2行目の境界', () => {
    const o = { hasVsPill: true, hasInsight: true };
    expect(pickNameFontSizePx(12, o)).toBe(14);
    expect(pickNameFontSizePx(13, o)).toBe(12);
    expect(pickNameFontSizePx(14, o)).toBe(12);
    expect(pickNameFontSizePx(15, o)).toBe(11);
  });
  it('シングルス（名前1つ）は gap 無し', () => {
    expect(pickNameFontSizePx(19, { hasVsPill: false, hasInsight: false, nameCount: 1 })).toBe(14);
  });
});
