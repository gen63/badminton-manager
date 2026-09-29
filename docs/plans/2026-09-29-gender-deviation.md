# 履歴画面に男女別偏差値を追加

## 目的
強さ偏差値は男女混合の全体で標準化されるため、同性内での位置が分かりにくい。同性内で標準化した偏差値を併記する。

## 設計
- `computePerformanceRatings` の θ 推定は全員で行う（混合試合で物差しが繋がる）。既存の `deviation` も不変。
- `PlayerPerformance.genderDeviation: number | null` と表示ラベル用 `gender` を追加。平均・標準偏差のみ、その日の同性の評価対象者で取り直す。性別未設定は null、sd≈0（同性1人など）は 50。
- UI: `PlayerRecordSummary` は `偏差値 55（男子内 58）`、`PerformanceRanking` 行は `偏差 55 / 男子内 58`。説明文に男女別の説明を追記。並び順・順位は変更しない。

## スコープ
`src/lib/performanceRating.ts` / `.test.ts`、`src/pages/HistoryPage.tsx` のみ。
