export interface Player {
  id: string;
  name: string;
  rating?: number;
  isResting: boolean;
  gamesPlayed: number;
  lastPlayedAt: number | null;
}

export interface PlayerStats {
  id: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  points: number;
}
