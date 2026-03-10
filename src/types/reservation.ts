export interface Reservation {
  id: string;
  orderNumber: number;           // 予約番号（通し番号）
  playerIds: string[];          // 1〜4人のプレイヤーID
  status: 'pending' | 'fulfilled';
  createdAt: number;
  fulfilledAt: number | null;
  createdBy?: string;           // 追加者の名前（オンラインモード時）
}
