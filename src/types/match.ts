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
  /**
   * 履歴画面「コートに戻す」用の復元情報。試合終了時（`computeFinishAndContinue`）
   * に埋める。旧データ（このフィールドが無い試合）は戻せない扱い。
   * 詳細: docs/plans/2026-09-28-remove-undo-revert-finish.md
   */
  finishRevert?: {
    /** 出場者（終了前の状態）。3人試合の空きスロット（空文字）は含まない */
    playersBefore: { id: string; isResting: boolean; forcedRestAt?: number }[];
    /** 終了直前のコートの付随状態（クリアで消える前の値） */
    court: { assignedAt?: number; startPressedAt?: number; restingPlayerIds?: string[] };
    /** 終了時＋連続配置で pending → fulfilled にした予約の ID */
    fulfilledReservationIds: string[];
    /** 連続配置で開始した次の試合の startedAt（連続配置が成立しなかった場合は無し） */
    nextStartedAt?: number;
    /** 連続配置の次の組で休憩から呼び出したメンバーの ID */
    nextActivatedFromRestIds?: string[];
  };
}
