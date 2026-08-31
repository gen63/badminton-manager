export interface PairPreference {
  id: string;
  playerIds: [string, string];
  strength: 'normal' | 'strong';
  createdAt: number;
  createdBy?: string;
}

/** `strength` から目標成立比率を導く。値は bench で決める */
export const TARGET_RATIO: Record<PairPreference['strength'], number> = {
  normal: 0.5,
  strong: 1.0,
};
