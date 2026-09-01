export interface PairPreference {
  id: string;
  playerIds: [string, string];
  /**
   * 強度。`normal` = ソフト（目的関数の第7項 `affinity` のみ・常に最大強度で
   * 押し続ける）、`strong` = ソフト + ハード制約（`evaluate()` の `StrongPair`
   * — 両方が出るなら必ず味方、かつ2人一緒に出るか2人とも控えるか）。
   *
   * 2026-09-01 に飽和（実績比率ベースの `TARGET_RATIO` / `deficit`）を廃止した
   * ため、`normal` と `strong` の違いはこのハード制約の有無だけになった。
   * `docs/plans/2026-08-31-pair-preference.md` 参照。
   */
  strength: 'normal' | 'strong';
  createdAt: number;
  createdBy?: string;
}
