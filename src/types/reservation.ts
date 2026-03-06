export interface Reservation {
  id: string;
  playerIds: string[];          // 1〜4人のプレイヤーID
  status: 'pending' | 'fulfilled';
  createdAt: number;
  fulfilledAt: number | null;
}
