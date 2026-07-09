export interface Match {
  id: string;
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  startedAt: number;
  finishedAt: number;
  winner?: 'A' | 'B';
  forcedRestAt?: number; // 結果未登録による出場者の強制休憩を実施・通知した時刻（Unix timestamp、未実施は undefined）
}
