/**
 * 会計計算の共通ロジック
 * AccountingPage と AccountingCalcPage で共有
 */

/** 練習種別ごとの会費デフォルト値 */
export const PRACTICE_TYPE_OPTIONS = [
  { value: '複', maleFee: 800, femaleFee: 600 },
  { value: '単', maleFee: 1200, femaleFee: 800 },
  { value: '楽', maleFee: 600, femaleFee: 400 },
] as const;

/** 体育館名を略称に変換 */
export function toGymShortName(gym: string): string {
  if (gym.includes('目白')) return '目白';
  if (gym.includes('千早')) return '千早';
  if (gym.includes('南長崎')) return '南長崎';
  if (gym.includes('巣鴨')) return '巣鴨';
  return gym;
}

/** 会計計算の入力値（totals / copy text 共通） */
export interface AccountingInputValues {
  exemptCount: number;
  maleCount: number;
  femaleCount: number;
  maleFee: number;
  femaleFee: number;
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  otherAmount: number;
}

export interface AccountingTotals {
  participantCount: number;
  maleTotal: number;
  femaleTotal: number;
  incomeTotal: number;
  shuttleTotal: number;
  finalTotal: number;
  shuttleUsableCount: number;
}

/** 会計の各種合計値を計算（入力値のみから算出、純粋関数） */
export function calculateAccountingTotals(input: AccountingInputValues): AccountingTotals {
  const participantCount = input.exemptCount + input.maleCount + input.femaleCount;
  const maleTotal = input.maleCount * input.maleFee;
  const femaleTotal = input.femaleCount * input.femaleFee;
  const incomeTotal = maleTotal + femaleTotal;
  const shuttleTotal = input.shuttleCount * input.shuttlePrice;
  const finalTotal = incomeTotal - input.gymCost - shuttleTotal + input.otherAmount;
  const shuttleUsableCount = input.shuttlePrice > 0
    ? Math.max(0, Math.floor((incomeTotal - input.gymCost + input.otherAmount) / input.shuttlePrice))
    : 0;
  return { participantCount, maleTotal, femaleTotal, incomeTotal, shuttleTotal, finalTotal, shuttleUsableCount };
}

export interface AccountingCopyInput extends AccountingInputValues {
  date: string; // YYYY/MM/DD
  gymShortName: string;
  practiceType: string;
  matchCount: number;
  otherDescription: string;
  /**
   * 平均試合数の算出に使う分母。試合履歴から得られる実参加者数など。
   * 未指定なら participantCount（exempt+男+女）をフォールバックとして使用。
   */
  activePlayerCount?: number;
}

/** コピー用テキストを生成（AccountingPage / AccountingCalcPage で共用） */
export function buildAccountingCopyText(input: AccountingCopyInput): string {
  const totals = calculateAccountingTotals(input);
  const { participantCount, incomeTotal, shuttleTotal, finalTotal, shuttleUsableCount } = totals;
  const {
    exemptCount, maleCount, femaleCount, maleFee, femaleFee,
    gymCost, shuttlePrice, shuttleCount, otherAmount,
    date, gymShortName, practiceType, matchCount, otherDescription, activePlayerCount,
  } = input;

  const lines: string[] = [
    `${date} ${gymShortName} ${practiceType}`,
    `参加合計 ${participantCount}人(免除${exemptCount} 男${maleCount} 女${femaleCount})`,
    '',
    '【収入】',
  ];

  const buildLine = (label: string, fee: number, count: number) =>
    count === 0 ? null : `${label} ${fee.toLocaleString()}×${count} = ${(fee * count).toLocaleString()}`;

  const maleLine = buildLine('男', maleFee, maleCount);
  const femaleLine = buildLine('女', femaleFee, femaleCount);
  if (maleLine) lines.push(maleLine);
  if (femaleLine) lines.push(femaleLine);
  if (exemptCount > 0) lines.push(`免除 ${exemptCount}×0 = 0`);

  // その他（プラスの場合は収入に追加）
  if ((otherDescription || otherAmount !== 0) && otherAmount > 0) {
    lines.push(`${otherDescription || 'その他'} ${otherAmount.toLocaleString()}`);
  }

  const incomeTotalForCopy = incomeTotal + (otherAmount > 0 ? otherAmount : 0);
  lines.push(`収入合計 ${incomeTotalForCopy.toLocaleString()}`);

  lines.push(
    '',
    '【支出】',
    `体育館 -${gymCost.toLocaleString()}`,
    `シャトル使用数 -${shuttlePrice}×${shuttleCount} = -${shuttleTotal.toLocaleString()}`,
  );

  // その他（マイナスの場合は支出に追加）
  if ((otherDescription || otherAmount !== 0) && otherAmount < 0) {
    lines.push(`${otherDescription || 'その他'} ${otherAmount.toLocaleString()}`);
  }

  let totalFormula = `${incomeTotal.toLocaleString()}-${gymCost.toLocaleString()}-${shuttleTotal.toLocaleString()}`;
  if (otherAmount !== 0) {
    totalFormula += otherAmount >= 0 ? `+${otherAmount.toLocaleString()}` : `${otherAmount.toLocaleString()}`;
  }

  lines.push('', '【合計】', `${totalFormula} = ${finalTotal.toLocaleString()}`);

  const referenceLines: string[] = [];
  const appropriateFee = calculateAppropriateFee({
    gymCost, shuttleTotal, otherAmount, maleCount, femaleCount, practiceType,
  });

  if (matchCount > 0) {
    const denominator = activePlayerCount ?? participantCount;
    const playersPerMatch = practiceType === '単' ? 2 : 4;
    const avgMatches = denominator > 0 ? (matchCount * playersPerMatch / denominator).toFixed(1) : '0.0';
    if (shuttleCount > 0) {
      const matchesPerShuttle = (matchCount / shuttleCount).toFixed(1);
      referenceLines.push(`試合数 ${matchCount}試合 (平均${avgMatches}試合/人, 1個で${matchesPerShuttle}試合)`);
    } else {
      referenceLines.push(`試合数 ${matchCount}試合 (平均${avgMatches}試合/人)`);
    }
  }

  if (shuttlePrice > 0) {
    referenceLines.push(`シャトル使用可能数 ${shuttleUsableCount}個`);
  }

  if (gymShortName !== '千川館') {
    referenceLines.push(`適正会費: 男${appropriateFee.male}円 女${appropriateFee.female}円`);
    if (gymCost <= 900 && (Math.abs(maleFee - appropriateFee.male) >= 200 || Math.abs(femaleFee - appropriateFee.female) >= 200)) {
      referenceLines.push('⚠️ 適正会費と会費の差が200円以上あります、調整を検討してください。');
    }
  }

  if (referenceLines.length > 0) {
    lines.push('', '【参考】', ...referenceLines);
  }

  return lines.join('\n');
}

/** 適正会費の計算（最小黒字 + 100円） */
export function calculateAppropriateFee(params: {
  gymCost: number;
  shuttleTotal: number;
  otherAmount: number;
  maleCount: number;
  femaleCount: number;
  practiceType: string;
}): { male: number; female: number } {
  const { gymCost, shuttleTotal, otherAmount, maleCount, femaleCount, practiceType } = params;
  const totalExpense = gymCost + shuttleTotal - otherAmount;
  if (maleCount + femaleCount === 0) return { male: 0, female: 0 };

  // 練習種別に応じた男女差額
  const genderDiff = practiceType === '単' ? 400 : 200;

  let minProfitMale = 0;
  let minProfit = Infinity;

  // 探索上限を動的に計算
  const maxFee = Math.max(1500, Math.ceil(totalExpense / Math.max(1, maleCount + femaleCount) / 100) * 100 + 500);

  // 男子の会費を100円刻みで探索
  for (let male = genderDiff; male <= maxFee; male += 100) {
    const female = male - genderDiff;
    if (female < 0) continue;

    const income = male * maleCount + female * femaleCount;
    const profit = income - totalExpense;

    if (profit >= 0 && profit < minProfit) {
      minProfit = profit;
      minProfitMale = male;
    }
  }

  // 適正会費 = 最小黒字会費 + 100円
  const appropriateMale = minProfitMale + 100;
  const appropriateFemale = appropriateMale - genderDiff;

  return {
    male: appropriateMale,
    female: appropriateFemale,
  };
}
