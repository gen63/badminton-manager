export interface Court {
  id: number;
  teamA: [string, string]; // [player1Id, player2Id]
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  isPlaying: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  restingPlayerIds?: string[]; // 元々休憩中だったプレイヤーID
}

export interface CourtAssignment {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
}
