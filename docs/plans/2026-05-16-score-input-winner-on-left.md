# 2026-05-16 スコア入力画面で勝者を左に表示

## 背景

`HistoryPage` の試合カードは `match.winner` を見て勝者を左に表示する
（`src/pages/HistoryPage.tsx:42-46`）。一方、`ScoreInputPage` は常に
`teamA` を左、`teamB` を右に固定で表示している。

このため、履歴で「Bチームが勝った試合」を編集ボタンで開くと、左右が
入れ替わって見えてしまい、利用者が混乱する。

## 要求

- 履歴からスコアを開いた時、履歴カードと同じレイアウトで表示する
  （勝者を左、敗者を右）
- スコア入力の点数タップも「左チーム→右チーム」の順となるようにする
  （= 編集モードで開いた時、最初のタップで勝者のスコア、次のタップで
  敗者のスコアを入力する）
- 開いた時は既存スコアをクリアした空の状態でスタートする。履歴からの
  編集は「訂正」前提のため、一部の数字だけ書き換える操作よりも、
  まっさらから入れ直す方が分かりやすい（SCORE1 fix は反転）

## 設計

`ScoreInputPage` に表示用の左右入れ替えフラグを追加する。

```ts
// match.winner === 'B' の時、teamB を左に表示する
const swap = match.winner === 'B';
```

- 内部状態は `scoreA` / `scoreB` のまま（=データ上の teamA/teamB に紐づく）。
  `writer.updateMatchScore(matchId, scoreA, scoreB, winner)` の呼び出しを
  変更しない。
- 表示は `leftScore = swap ? scoreB : scoreA` のように左右を派生させる。
- `handleNumberClick` も「左→右」の順で `scoreA`/`scoreB` を埋める。
  swap が true なら最初のタップで `scoreB`、次に `scoreA` をセット。
- `scoreA` / `scoreB` / `inputHistory` の初期値は常に 0 / 0 / `[]`
  （SCORE1 fix の既存スコア復元は撤回）。
- プレイヤーボタンは `swap` に応じて視覚順序を入れ替える。`handlePlayerTap`
  の position 引数は従来通りデータ index (`teamA[0]`=0, `teamA[1]`=1,
  `teamB[0]`=2, `teamB[1]`=3) を保つ。

## 影響範囲

- 編集対象: `src/pages/ScoreInputPage.tsx` のみ
- 未入力試合（winner なし）の場合は従来通り teamA を左に表示（変更なし）
- `ScoreInputModal` は試合終了直後のフロー専用で常に新規入力。winner が
  まだ存在しないので影響なし（変更不要）。

## 検証

- 履歴で teamA 勝ち試合の編集 → 表示そのまま (teamA 左)、スコアは空
- 履歴で teamB 勝ち試合の編集 → 表示が左右入れ替わり、左に teamB の
  プレイヤー、スコアは空
- 最初のタップが左 (winner) のスコア、次のタップが右 (loser) のスコア
- 未入力試合の編集 → 従来通り teamA 左、スコアは空
- 確定後の `winner` フィールドの値が正しい（表示の入れ替えに依存せず、
  内部の `scoreA`/`scoreB` から計算される）
- 何も入力せずに閉じた場合は既存スコアが Firestore 上に残る
  （`handleConfirm` を呼ばないため）
