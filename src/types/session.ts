export interface SessionConfig {
  courtCount: number;
  targetScore: number;
  practiceDate: string;
  practiceStartTime: number; // 練習開始日時（Unix timestamp）
  gym?: string; // 体育館名
}

export const GYM_OPTIONS = ['ぴいす', '目白', '高松', '富士見台'] as const;

export interface Session {
  id: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
}
