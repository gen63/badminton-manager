export interface Reservation {
  id: string;
  orderNumber: number;           // 予約番号（通し番号）
  playerIds: string[];          // 1〜4人のプレイヤーID
  status: 'pending' | 'fulfilled';
  createdAt: number;
  fulfilledAt: number | null;
}
