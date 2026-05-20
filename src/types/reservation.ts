export interface Reservation {
  id: string;
  orderNumber: number;           // 予約番号（通し番号）
  playerIds: string[];          // 1〜4人のプレイヤーID
  status: 'pending' | 'fulfilled';
  createdAt: number;            // 作成時刻（Unix timestamp）
  fulfilledAt: number;          // 完了時刻（Unix timestamp、未完了時は0）
  createdBy?: string;           // 追加者の名前
}
