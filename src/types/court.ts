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

/** コートの空状態（配置なし・試合なし） */
export const EMPTY_COURT_STATE = {
  teamA: ['', ''] as [string, string],
  teamB: ['', ''] as [string, string],
  scoreA: 0,
  scoreB: 0,
  isPlaying: false,
  startedAt: 0,
  finishedAt: 0,
} as const satisfies Omit<Court, 'id' | 'restingPlayerIds'>;

export interface CourtAssignment {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
}
