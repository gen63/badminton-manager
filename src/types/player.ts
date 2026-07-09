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
}
