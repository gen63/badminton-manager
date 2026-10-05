/**
 * 「勝者のみ入力」（スコア不明で勝敗だけ記録）の際に保存するダミースコア。
 * UnrecordedMatchPrompt が書き込み、performanceRating が「スコア未入力」として扱う。
 */
export const WINNER_ONLY_SCORE = { winner: 100, loser: 99 } as const;

/** 勝者のみ入力のダミースコア（どちらの向きでも）か。 */
export function isWinnerOnlyScore(scoreA: number, scoreB: number): boolean {
  const { winner, loser } = WINNER_ONLY_SCORE;
  return (
    (scoreA === winner && scoreB === loser) || (scoreA === loser && scoreB === winner)
  );
}
