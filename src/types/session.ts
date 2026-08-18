type GameMode = 'singles' | 'doubles';

export interface SessionConfig {
  courtCount: number;
  targetScore: number;
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

/** 会計ページの入力状態（セッションごとに Firestore に保存される） */
export interface AccountingInput {
  exemptCount: number;
  maleCount: number;
  femaleCount: number;
  maleFee: number;
  femaleFee: number;
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  matchCount: number;
  practiceType: string;
  otherDescription?: string;
  otherAmount?: number;
}

/** 試合結果の GAS アップロード記録（セッション一覧での未実施検出用） */
interface MatchUploadStatus {
  uploadedAt: number; // アップロード成功時刻
  uploadedBy?: string; // 実行者（currentUser があるときのみ）
  matchCount: number; // アップロード時点の試合数（差分検出用）
}

/** 会計データの GAS アップロード記録 */
interface AccountingUploadStatus {
  uploadedAt: number;
  uploadedBy?: string;
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
  createdBy?: string;
  admins?: string[]; // 追加管理者のリスト
  participants?: string[];
  registeredPlayers?: string[]; // セッション作成時に登録された選手名
  status?: 'active' | 'ended';
  information?: SessionInformation; // 周知事項
  accounting?: AccountingInput; // 会計ページの入力状態（管理者が共有編集）
  matchUpload?: MatchUploadStatus; // 試合結果アップロード記録（未設定 = 未アップロード）
  accountingUpload?: AccountingUploadStatus; // 会計アップロード記録（未設定 = 未アップロード）
  presence?: { [username: string]: PresenceEntry }; // 画面を開いている/操作中のユーザー
  /** 最終画面参照時刻 (Unix ms, クライアント時刻)。presence と違い削除しない */
  lastSeen?: { [username: string]: number };
  etomoEventId?: string; // E-tomoイベントID（自動作成時の重複防止用）
  firstMatchStartedAt?: number | null; // 最初の試合開始時刻。null/未設定 = 試合未開始（12h自動アーカイブ判定用）
  // 一覧表示用の派生フィールド（docToSession で gameState から抽出）
  matchCount?: number;
  paidCount?: number; // 支払い完了済みプレイヤー数（gameState.players から算出）
  incomeTotal?: number; // 収入合計（運営協力割引・その他収入込み）。accounting 未設定なら undefined
  medianGamesPlayed?: number; // 1人あたり試合数の中央値（gamesPlayed > 0 のプレイヤーのみが母集団）。該当0人なら undefined
  practiceType?: '単' | '複' | '楽';
  recordScores?: boolean; // 勝敗記録モード（gameState.settings.recordScores）。未設定 = ON 扱い
  /** 最後に終わった試合の終了時刻。null = 終了時刻を持つ試合なし（30分自動アーカイブ判定用） */
  lastMatchFinishedAt?: number | null;
  /** コートに試合が進行中（配置済み含む）か。練習中は一覧から消さないための判定用 */
  hasActiveCourt?: boolean;
}
