export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
}

export interface Session {
  id: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
}
