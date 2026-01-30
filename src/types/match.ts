export interface Match {
  id: string;
  courtId: number;
  teamA: [string, string];
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  startedAt: number;
  finishedAt: number;
  winner: 'A' | 'B';
}

export interface MatchLog extends Match {
  playerNames: {
    teamA: [string, string];
    teamB: [string, string];
  };
}
