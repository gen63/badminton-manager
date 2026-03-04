export interface AccountingRecord {
  id: string;
  timestamp: number;
  date: string; // YYYY/MM/DD
  gym: string;
  participantCount: number;
  exemptCount: number;
  maleCount: number;
  femaleCount: number;
  maleFee: number;
  femaleFee: number;
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  otherDescription?: string;
  otherAmount?: number;
  maleTotal: number;
  femaleTotal: number;
  shuttleTotal: number;
  finalTotal: number;
}
