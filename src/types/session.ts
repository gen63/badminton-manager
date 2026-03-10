export type GameMode = 'singles' | 'doubles';

export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number; // 練習開始日時（Unix timestamp）
  gym?: string; // 体育館名
  gameMode?: GameMode; // ゲームモード（デフォルト: 'doubles'）
}

export const GYM_OPTIONS = ['ぴいす', '目白', '高松', '富士見台', '千川館'] as const;

export interface SessionInformation {
  text: string;
  updatedAt: number;
  updatedBy?: string; // 更新者の名前
  readBy: string[]; // 既読ユーザー名の配列
}

export interface Session {
  id: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
  // オンラインモード用フィールド
  createdBy?: string;
  admins?: string[]; // 追加管理者のリスト
  participants?: string[];
  registeredPlayers?: string[]; // セッション作成時に登録された選手名
  status?: 'active' | 'ended';
  information?: SessionInformation; // 周知事項
}
