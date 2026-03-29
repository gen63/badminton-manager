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
