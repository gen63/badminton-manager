export type GameMode = 'singles' | 'doubles';

export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number; // 練習開始日時（Unix timestamp）
  gym?: string; // 体育館名
  gameMode?: GameMode; // シングルス/ダブルス（デフォルト: doubles）
}

export const GYM_OPTIONS = ['ぴいす', '目白', '高松', '富士見台', '千川館'] as const;

export interface SessionInformation {
  text: string;
  updatedAt: number;
  updatedBy?: string; // 更新者の名前
  readBy: string[]; // 既読ユーザー名の配列
}

/**
 * プレゼンス情報（二重操作抑止のための画面レベルの在席表示）
 * - lastSeenAt: 最終ハートビート（クライアント時刻）
 * - lastTapAt:  最終タップ（クライアント時刻）。存在すれば「操作しそう」の強シグナル
 */
export interface PresenceEntry {
  lastSeenAt: number;
  lastTapAt?: number;
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
  presence?: { [username: string]: PresenceEntry }; // 画面を開いている/操作中のユーザー
  etomoEventId?: string; // E-tomoイベントID（自動作成時の重複防止用）
  firstMatchStartedAt?: number | null; // 最初の試合開始時刻。null/未設定 = 試合未開始（12h自動アーカイブ判定用）
  // 一覧表示用の派生フィールド（docToSession で gameState から抽出）
  matchCount?: number;
  practiceType?: '単' | '複' | '楽';
}
