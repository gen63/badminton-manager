# 試合履歴ページ「自分の試合のみ」フィルタ機能

**日付**: 2026-04-25
**ブランチ**: `claude/filter-match-history-cxdE7`

## 背景・目的

参加者が多いセッションでは試合履歴に多数の試合が並び、自分が参加した試合を探しにくい。
HistoryPage に「自分の試合のみ」を絞り込むトグルを追加し、自分視点での確認を素早くできるようにする。

## 既存実装の調査結果

- `Match.teamA / teamB` は **player ID** を持つ（`src/types/match.ts`）。
- `sessionStore.currentUser` は **プレイヤー名（string）** をセッション参加時に保持（`SessionJoinPage.tsx:172`）。
- `BottomNav.tsx:30-53` で **既に「自分が参加した未入力試合」を絞り込むロジック** が稼働中（履歴タブの未入力件数バッジに利用）。同じ判定ロジックを HistoryPage 表示にも流用できる。
- `players.find((p) => p.name === currentUser)` は `MainPage.tsx`, `useFirebaseSync.ts` でも頻出する確立済みパターン。
- 名前のユニーク性はセッション作成時にしかチェックされない（`SessionCreate.tsx:340`）。同名プレイヤーが存在し得るが、既存の BottomNav バッジと同じ前提を踏襲する。

## 仕様

### 動作
- 試合履歴カードの最上部に **トグルピル**（`自分の試合のみ`）を配置。
- ON 時、`teamA` / `teamB` のいずれかに `currentUser` 名のプレイヤー ID が含まれる試合のみ表示。
- 「未入力」「入力済み」両グループに同じフィルタを適用。
- 試合番号（`#15` など）は **全試合中の通し番号を維持**（フィルタ後も飛び飛びになるが意味的に正しい）。
- 「入力済み」自動折り畳み判定は **フィルタ後の `hasUnscored` で実施**（自分視点で見た時の挙動を一致させる）。
- フィルタ ON で該当 0 件 → 専用 EmptyState を表示。

### 適用範囲
- フィルタは **画面表示のみ** に作用。
- コピー/Sheets アップロードは **常に全件**（管理者操作・セッション全体のデータ集約が目的）。

### 状態
- ローカル `useState<boolean>(false)`。永続化なし（既存の `scoredCollapsed` パターンに準拠）。
- ページを開き直すと OFF にリセット。

### 表示条件
- ローカルモード（`session.createdBy` なし）または `currentUser == null` のとき、トグル自体を非表示。
- `currentUser` が `players` 配列に見つからない場合は該当 0 件として通常通り処理。

### UI
- 既存の「入力済み（N件）」折り畳みボタンと同じ indigo 配色を継承。
- ON: `#e0e7ff` / `#3730a3` 背景。
- OFF: グレー系（`bg-secondary` 相当）。
- `min-h-[44px]`、`aria-pressed`、`aria-label` を付与。

## 実装計画

### 1. 共通ロジックの切り出し（新規）
- `src/lib/matchFilter.ts`
  ```ts
  export function isMatchOfPlayer(
    match: Match,
    playerName: string | null,
    players: Player[]
  ): boolean
  ```
- 純粋関数。`playerName == null` または該当プレイヤーが見つからないなら `false`。

### 2. ユニットテスト（新規）
- `src/lib/matchFilter.test.ts`
- ケース: ダブルス含/含まない、シングルス（空文字 `''`）、currentUser=null、該当プレイヤー未登録、空文字 ID 偶然一致しない。

### 3. HistoryPage 変更
- `src/pages/HistoryPage.tsx`
  - `myMatchesOnly` ステート追加。
  - `currentUser` & `players` を取得。
  - フィルタトグル UI（ローカルモード時は非表示）。
  - `MatchList` に `filteredMatches` と `myMatchesOnly` 関連 props を渡す。
  - 該当 0 件時の EmptyState 切替。

### 4. BottomNav リファクタ
- `src/components/BottomNav.tsx` の自前ロジックを `isMatchOfPlayer` で置換（DRY 化）。

### 5. コミット前チェック
- `npm run build`
- `npm run lint`
- `npm run test:run`

## 影響範囲

- `src/lib/matchFilter.ts`（新規）
- `src/lib/matchFilter.test.ts`（新規）
- `src/pages/HistoryPage.tsx`（編集）
- `src/components/BottomNav.tsx`（編集・リファクタ）

## トレードオフ・将来検討

- フィルタ状態の永続化は今回スコープ外。ユーザー要望が出れば `settingsStore` に追加。
- 同名プレイヤー問題（`players.find` が最初の一致を返す）は既存仕様を踏襲。根本対策は別タスク。
- コピー/アップロードを「フィルタ反映」にしたい要望が出た場合は別途検討。
