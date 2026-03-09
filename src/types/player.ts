export interface Player {
  id: string;
  name: string;
  rating?: number;
  gender?: 'M' | 'F';
  isResting: boolean;
  gamesPlayed: number;
  lastPlayedAt: number | null;
  activatedAt: number | null; // 休憩→待機になった時刻（チェックイン）
  operationStatus?: {
    payment: boolean;   // 支払完了
    roster: boolean;    // 名簿確認完了
    checkin: boolean;   // チェックイン完了
  };
}

export interface PlayerStats {
  id: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  points: number;
}
