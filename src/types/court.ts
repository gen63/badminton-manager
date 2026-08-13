export interface Court {
  id: number;
  teamA: [string, string]; // [player1Id, player2Id]
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  isPlaying: boolean;
  startedAt: number; // 試合開始時刻（Unix timestamp、未設定時は0）
  finishedAt: number; // 試合終了時刻（Unix timestamp、未設定時は0）
  /**
   * コートに配置した時刻（Unix timestamp、未設定時は0）。
   * 「開始」が押されないまま `MATCH_AUTO_START_MS` を超えた場合の自動開始の基準で、
   * 自動開始時はこの時刻がそのまま `startedAt` になる。
   * 旧データには存在しないため読み出しは `?? 0`。
   */
  assignedAt?: number;
  /** 休憩からタップ交換で出場したメンバー。試合終了時に休憩へ戻す。 */
  restingPlayerIds?: string[];
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
  assignedAt: 0,
  restingPlayerIds: [] as string[],
} as const satisfies Omit<Court, 'id'>;

export interface CourtAssignment {
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
  /** 休憩中から予約で呼び出して出場させるメンバー。配置側が isResting=false にする。 */
  activatedFromRestIds?: string[];
}
