export interface Court {
  id: number;
  teamA: [string, string]; // [player1Id, player2Id]
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  isPlaying: boolean;
  startedAt: number; // 試合開始時刻（Unix timestamp、未設定時は0）
  finishedAt: number; // 試合終了時刻（Unix timestamp、未設定時は0）
  restingPlayerIds?: string[]; // 元々休憩中だったプレイヤーID
}

export interface CourtAssignment {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
}
