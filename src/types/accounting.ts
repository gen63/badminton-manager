export interface AccountingRecord {
  id: string;
  timestamp: number;
  date: string; // YYYY/MM/DD
  gym: string;
  practiceType: string; // 複/単/楽
  maleCount: number;
  maleFee: number;
  femaleCount: number;
  femaleFee: number;
  exemptCount: number;
  participantCount: number;
  matchCount: number;
  members: string; // JSON形式: [{"name":"山田太郎","gender":"M"}]
  incomeTotal: number; // 収入合計
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  expenseTotal: number; // 支出合計
  otherDescription?: string;
  otherAmount?: number;
  finalTotal: number;
}
