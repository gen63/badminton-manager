import { describe, it, expect } from 'vitest';
import {
  buildAccountingCopyText,
  calculateAccountingTotals,
  calculateAppropriateFee,
  toGymShortName,
} from './accountingCalc';

describe('calculateAccountingTotals', () => {
  const base = {
    exemptCount: 2,
    maleCount: 4,
    femaleCount: 2,
    maleFee: 400,
    femaleFee: 400,
    gymCost: 900,
    shuttlePrice: 480,
    shuttleCount: 0,
    otherAmount: 0,
  };

  it('基本的な収入・合計を算出する', () => {
    const t = calculateAccountingTotals(base);
    expect(t.participantCount).toBe(8);
    expect(t.maleTotal).toBe(1600);
    expect(t.femaleTotal).toBe(800);
    expect(t.incomeTotal).toBe(2400);
    expect(t.shuttleTotal).toBe(0);
    expect(t.finalTotal).toBe(2400 - 900);
  });

  it('shuttlePrice=0 のときは shuttleUsableCount=0 にする（0除算回避）', () => {
    const t = calculateAccountingTotals({ ...base, shuttlePrice: 0, shuttleCount: 0 });
    expect(t.shuttleUsableCount).toBe(0);
  });

  it('otherAmount（プラス）を finalTotal に加算する', () => {
    const t = calculateAccountingTotals({ ...base, otherAmount: 400 });
    expect(t.finalTotal).toBe(2400 - 900 + 400);
  });

  it('otherAmount（マイナス）を finalTotal から差し引く', () => {
    const t = calculateAccountingTotals({ ...base, otherAmount: -300 });
    expect(t.finalTotal).toBe(2400 - 900 - 300);
  });

  it('shuttleUsableCount は incomeTotal − 体育館代 + その他 / shuttlePrice の整数部', () => {
    const t = calculateAccountingTotals({
      ...base,
      shuttlePrice: 480,
      otherAmount: 0,
    });
    // (2400 - 900 + 0) / 480 = 3.125 → 3
    expect(t.shuttleUsableCount).toBe(3);
  });

  it('discount（運営協力割引）を finalTotal から差し引く', () => {
    const t = calculateAccountingTotals({ ...base, discount: 200 });
    // incomeTotal=2400, gymCost=900, shuttle=0, other=0, discount=200
    expect(t.finalTotal).toBe(2400 - 900 - 200);
    expect(t.discount).toBe(200);
  });

  it('discount 未指定時は 0 として扱う', () => {
    const t = calculateAccountingTotals(base);
    expect(t.discount).toBe(0);
    expect(t.finalTotal).toBe(2400 - 900);
  });

  it('shuttleUsableCount は discount を差し引いて算出する', () => {
    const t = calculateAccountingTotals({
      ...base,
      shuttlePrice: 480,
      discount: 200,
    });
    // (2400 - 900 - 200) / 480 = 2.708 → 2
    expect(t.shuttleUsableCount).toBe(2);
  });
});

describe('buildAccountingCopyText', () => {
  const base = {
    date: '2026/04/22',
    gymShortName: '富士見台',
    practiceType: '楽',
    exemptCount: 2,
    maleCount: 4,
    femaleCount: 2,
    maleFee: 400,
    femaleFee: 400,
    gymCost: 900,
    shuttlePrice: 480,
    shuttleCount: 0,
    otherAmount: 400,
    matchCount: 0,
    otherDescription: 'ツムラ',
  };

  it('ヘッダ・収入・支出・合計・参考セクションを順に出力する', () => {
    const text = buildAccountingCopyText(base);
    expect(text).toContain('2026/04/22 富士見台 楽');
    expect(text).toContain('参加合計 8人(免除2 男4 女2)');
    expect(text).toContain('【収入】');
    expect(text).toContain('男 400×4 = 1,600');
    expect(text).toContain('女 400×2 = 800');
    expect(text).toContain('免除 2×0 = 0');
    expect(text).toContain('ツムラ 400');
    expect(text).toContain('収入合計 2,800');
    expect(text).toContain('【支出】');
    expect(text).toContain('体育館 -900');
    expect(text).toContain('【合計】');
    expect(text).toContain('2,400-900-0+400 = 1,900');
  });

  it('maleCount/femaleCount が 0 の行は出力されない', () => {
    const text = buildAccountingCopyText({ ...base, maleCount: 0 });
    expect(text).not.toMatch(/^男/m);
    expect(text).toContain('女 400×2 = 800');
  });

  it('exemptCount が 0 なら免除行は出力されない', () => {
    const text = buildAccountingCopyText({ ...base, exemptCount: 0 });
    // ヘッダー "(免除0 男... 女...)" は出るが "免除 0×0 = 0" の行は出ない
    expect(text).not.toMatch(/^免除 /m);
  });

  it('discount > 0 のとき支出セクションに運営協力行と合計式に -discount が出る', () => {
    const text = buildAccountingCopyText({ ...base, discount: 200 });
    const expenseIdx = text.indexOf('【支出】');
    const totalIdx = text.indexOf('【合計】');
    expect(text.indexOf('運営協力 -200')).toBeGreaterThan(expenseIdx);
    expect(text.indexOf('運営協力 -200')).toBeLessThan(totalIdx);
    // 合計式: 2,400-900-0-200+400 = 1,700
    expect(text).toContain('2,400-900-0-200+400 = 1,700');
  });

  it('discount = 0 のときは運営協力行を出さない', () => {
    const text = buildAccountingCopyText(base);
    expect(text).not.toContain('運営協力');
  });

  it('otherAmount が負の場合は支出セクションに追加される', () => {
    const text = buildAccountingCopyText({
      ...base,
      otherAmount: -500,
      otherDescription: '備品',
    });
    // 支出側に現れる
    const expenseIdx = text.indexOf('【支出】');
    const totalIdx = text.indexOf('【合計】');
    expect(text.indexOf('備品 -500')).toBeGreaterThan(expenseIdx);
    expect(text.indexOf('備品 -500')).toBeLessThan(totalIdx);
  });

  it('matchCount があるとき参考セクションに平均試合数が出る', () => {
    const text = buildAccountingCopyText({
      ...base,
      matchCount: 12,
      shuttleCount: 3,
    });
    expect(text).toContain('【参考】');
    expect(text).toContain('試合数 12試合');
    // 楽なら 4人/試合: 12*4/8 = 6.0
    expect(text).toContain('平均6.0試合/人');
    // 12/3=4.0
    expect(text).toContain('1個で4.0試合');
  });

  it('activePlayerCount 指定時はそちらを分母にする', () => {
    const text = buildAccountingCopyText({
      ...base,
      matchCount: 10,
      activePlayerCount: 5,
    });
    // 楽なら 4人/試合: 10*4/5 = 8.0
    expect(text).toContain('平均8.0試合/人');
  });

  it('千川館の場合は適正会費行を出さない', () => {
    const text = buildAccountingCopyText({ ...base, gymShortName: '千川館' });
    expect(text).not.toContain('適正会費');
  });

  it('体育館代900円以下かつ差額200円以上なら警告行が出る', () => {
    const text = buildAccountingCopyText({
      ...base,
      maleFee: 800, // 適正会費との差が大きくなる設定
      femaleFee: 600,
    });
    expect(text).toMatch(/⚠️.*200円以上/);
  });
});

describe('calculateAppropriateFee', () => {
  it('参加人数 0 のとき 0 を返す', () => {
    const fee = calculateAppropriateFee({
      gymCost: 900, shuttleTotal: 0, otherAmount: 0,
      maleCount: 0, femaleCount: 0, practiceType: '複',
    });
    expect(fee).toEqual({ male: 0, female: 0 });
  });

  it('複の男女差額は 200 円', () => {
    const fee = calculateAppropriateFee({
      gymCost: 900, shuttleTotal: 0, otherAmount: 0,
      maleCount: 4, femaleCount: 2, practiceType: '複',
    });
    expect(fee.male - fee.female).toBe(200);
  });

  it('単の男女差額は 400 円', () => {
    const fee = calculateAppropriateFee({
      gymCost: 900, shuttleTotal: 0, otherAmount: 0,
      maleCount: 4, femaleCount: 2, practiceType: '単',
    });
    expect(fee.male - fee.female).toBe(400);
  });
});

describe('toGymShortName', () => {
  it('既知の体育館名を略称に変換する', () => {
    expect(toGymShortName('目白スポーツセンター')).toBe('目白');
    expect(toGymShortName('千早体育館')).toBe('千早');
  });

  it('未知の体育館はそのまま返す', () => {
    expect(toGymShortName('新宿体育館')).toBe('新宿体育館');
    expect(toGymShortName('')).toBe('');
  });
});
