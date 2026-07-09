# 2026-07-09 コードクリーンアップ（不要コード削除・ブラッシュアップ）

## 背景

2026-05 の Firestore 真実のソース化リファクタ（Phase 1-5）以降、参照されなく
なったコンポーネント・関数・型が残っていた。knip による静的解析と手動 grep で
参照ゼロを確認した上で削除する。

## 分析方法

- `npx knip` で未使用ファイル / エクスポート / 依存を検出
- 各候補を `grep -rn <symbol> src e2e scripts` で再検証（knip の誤検出を排除）
- ベースライン: build / lint / test:run（424件）すべてグリーンの状態から開始

## 実施内容

### 1. 未使用ファイルの削除（参照ゼロ確認済み）

- `src/components/CourtCard.tsx`（旧コート表示。MainPage はインライン実装に移行済み）
- `src/components/LoadingSpinner.tsx`
- `src/components/PlayerSwapModal.tsx`（CHANGELOG で削除予定と記載されていたもの）
- `src/components/ReservationModal.tsx`
- `src/components/ScoreInputModal.tsx`
- `src/hooks/useGameTimer.ts`（CourtCard からのみ参照）
- `src/App.css`（import ゼロ）
- README.md のディレクトリ構造からも該当行を削除

### 2. 完全未使用のエクスポート削除

- `sessionMutations.ts`: `clearCourt` / `addMatch`（UI からもテストからも未使用）
- `inputValidation.ts`: `SESSION_ID_LENGTH`
- `types/match.ts`: `MatchLog`
- `types/player.ts`: `PlayerStats`

### 3. 不要な `export` キーワードの除去（ファイル内でのみ使用）

- `useSessionWriterToast.ts`: `useToastErrorHandler`
- `badge.ts`: `isBadgeSupported` / `setAppBadge`
- `gameOperations.ts`: `checkContinuousBlock`
- `notifications.ts`: `isNotificationSupported`
- `unrecordedDismissStore.ts`: `UNRECORDED_DISMISS_DURATION_MS`
- `presenceStore.ts`: `PresenceMap`
- `types/session.ts`: `GameMode` / `MatchUploadStatus` / `AccountingUploadStatus`

### 4. zustand ストアの死蔵アクション削除（約310行）

Firestore 真実のソース化により、UI からの書き込みは `useSessionWriter` →
`sessionMutations.ts`、ストアへの反映は `useFirebaseSync` の `setState` に
一本化された。その結果、ストアのアクションはセッション切替時の clear 系を
除きすべて呼び出しゼロになっていた（同名関数が `sessionMutations.ts` に
存在するため grep では `writer.<name>` 呼び出しと区別して確認）。

- `gameStore.ts`: `initializeCourts` / `resizeCourts` / `removeCourtById` /
  `updateCourt` / `startGame` / `finishGame` / `resetAllCourts` / `removeMatch`
  を削除。残: `courts` / `matchHistory` / `clearHistory`
- `playerStore.ts`: `addPlayers` / `removePlayer` / `toggleRest` /
  `updatePlayer` / `toggleOperationStatus` / `applyPayment` /
  `incrementGamesPlayed` / `setAllPlayersResting` を削除。
  残: `players` / `clearPlayers`
- `reservationStore.ts`: `addReservation` / `removeReservation` /
  `fulfillReservation` を削除。残: `reservations` / `clearReservations`
- `accountingStore.ts`: `removeRecord` を削除
- `sessionStore.ts`: `setSession` を削除
- `undoStore.ts`: 全アクション使用中のため変更なし

### 5. 設定・依存のクリーンアップ

- 非推奨の `.eslintignore` を削除し、`eslint.config.js` の `globalIgnores` に統合
  （lint 実行時の ESLintIgnoreWarning が解消）
- 未使用 devDependency `@testing-library/user-event` を削除

## 削除しないと判断したもの

- `docs/webhook.js`: GAS（Google Apps Script）デプロイ用ソース。ビルド対象外だが
  運用に必要な参照実装
- `scripts/generate-icons.mjs` + `sharp`: アイコン再生成用ツール
- `scripts/simulate-court-assignment.ts`: 配置アルゴリズムのシミュレータ
- `pwa-assets.config.ts`: @vite-pwa/assets-generator の CLI 設定

## 検証

`npm run build` / `npm run lint` / `npm run test:run` がすべてグリーンであることを
コミット前に確認。
