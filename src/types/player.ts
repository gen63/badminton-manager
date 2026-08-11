export interface Player {
  id: string;
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
  isResting: boolean;
  gamesPlayed: number;
  lastPlayedAt: number; // 最後にプレイした時刻（Unix timestamp、未設定時は0）
  activatedAt: number; // 休憩→待機になった時刻（チェックイン時刻、未設定時は0）
  operationStatus?: {
    payment: boolean;   // 支払完了
    roster: boolean;    // 名簿確認完了
    checkin: boolean;   // チェックイン完了
  };
  paymentAmount?: number; // 支払った金額（円）
  paymentTimestamp?: number; // 支払い実行時刻（Unix timestamp）
  paymentOperatorName?: string; // 支払い操作を実行した人（currentUser、未選択時は undefined）
  forcedRestAt?: number; // 会費・名簿未対応による強制休憩を実施・通知した時刻（Unix timestamp、未実施は undefined）
  opsCompletedAt?: number; // 会費・名簿が両方完了になった時刻（Unix timestamp、未完了は undefined、一度セットしたら不変）
}
