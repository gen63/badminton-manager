export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number; // 練習開始日時（Unix timestamp）
}

export interface Session {
  id: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
}
