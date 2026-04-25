# 履歴ページのペア内名前を強い順に並べ替え

**日付**: 2026-04-25
**ブランチ**: `claude/sort-history-by-strength-1gne7`

## 背景・目的

`HistoryPage` の試合カードでは、勝ちペア・負けペアの2人の名前を `team.map(getPlayerName).join(' ')` で表示しているが、現状の並び順は `match.teamA` / `match.teamB` 配列の生の順序（試合開始時のチーム編成順）に依存している。
**目的は履歴上のペア内表示順を「決定論的に一定」にすること**で、見やすさのための一次キーとして「強い順（rating 降順）」を採用する。レーティングが同点の場合でも一定の順になるよう、二次・三次のタイブレークを設ける。

履歴ページ以外（コピー/Sheets アップロードのCSV、メイン画面の表示など）は変更しない。

## 既存実装の調査結果

- `Player.rating?: number`（`src/types/player.ts`）。未設定 or 0 は「未レート」扱い。
- 並び順は `src/pages/HistoryPage.tsx:40-47` の `MatchCard` 内で決まる。
- `MatchCard` は現状 `getPlayerName(id) => string` だけを props で受け取る。`players` 配列は持たない。
- シングルス試合（`teamA[1] === ''`）は1人しか居らず、ソート対象外。

## 仕様

- `MatchCard` の `leftTeam` / `rightTeam` を、表示前に決定論的な比較関数でソート。
  - 第1キー: `rating` 降順。`(b.rating ?? 0) - (a.rating ?? 0)`。未レートは 0 として扱う。
  - 第2キー: `name` の `localeCompare` 昇順（同レート時の決定論的タイブレーク）。
  - 第3キー: `id` の `localeCompare` 昇順（同名・同レート時の最終フォールバック）。
  - これにより `match.teamA` への格納順がどうであれ、ペアの表示順は常に同一になる。
- プレイヤーが `players` 配列に見つからない場合は rating 0 / name '未設定' として扱う（`getPlayerName` / `getPlayerRating` の既存挙動）。
- シングルス試合は1人なのでソート不要（既存の分岐をそのまま維持）。
- CSVコピー (`handleCopyHistory`) は変更しない（`A選手1,A選手2` の意味が壊れるため）。
- Sheets アップロードも変更しない。

## 実装計画

### 1. `MatchCard` への `getPlayerRating` 関数 props 追加
- `getPlayerName` と同じパターンで `(id: string) => number` を渡す。
- 未登録プレイヤー / rating 未設定は `0` を返す。

### 2. ペア内ソート
- `MatchCard` 内で `leftTeam` / `rightTeam` を rating 降順にソートしてから `join`。

### 3. `HistoryPage` 側で `getPlayerRating` を定義して props 渡し
- `getPlayerName` と並べて `players.find(...)?.rating ?? 0` を返す関数を用意。

### 4. コミット前チェック
- `npm run build`
- `npm run lint`
- `npm run test:run`

## 影響範囲

- `src/pages/HistoryPage.tsx`（編集のみ）

## トレードオフ・将来検討

- 「強さ」を rating ではなく `applyStreakSwaps` の動的順序で評価するアプローチもあるが、履歴は過去時点の試合なので静的な rating が直感的。今回は rating ベースで実装。
- 全プレイヤーが未レートでも、name → id のタイブレークによりペア内表示順は決定論的に確定する。
- `match.teamA` の格納順そのものは変えない（編集画面 `ScoreInputPage` の position 0/1/2/3 は固定位置に依存しているため）。本変更は表示計算時のみのソート。
