export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number; // 練習開始日時（Unix timestamp）
  gym?: string; // 体育館名
}

export const GYM_OPTIONS = ['ぴいす', '目白', '高松', '富士見台'] as const;

export interface Session {
  id: string;
  config: SessionConfig;
  createdAt: number | string; // Unix timestamp or ISO string
  updatedAt: number;
  
  // Phase 1: セッション共有用フィールド
  createdBy?: string;          // 管理者名
  createdByUID?: string;        // LINE UID（Phase 1.5で追加）
  createdByIcon?: string;       // プロフィール画像URL（Phase 1.5で追加）
  participants?: string[];      // 入室済み参加者リスト
  status?: 'active' | 'finished'; // セッション状態
}
