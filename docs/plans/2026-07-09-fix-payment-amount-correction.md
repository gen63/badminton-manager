# 支払い金額の修正フローの改善（誤って未登録に戻る不具合の修正）

## 日付: 2026-07-09

## 問題

参加者一覧（`PlayerSelect.tsx`）/ メイン画面の「未完了タスク」（`MainPage.tsx`）で、
支払い済みの金額を修正しようとすると、支払い登録そのものが取り消されて
「未登録」状態に戻ってしまう。

例: 1200円で登録済み → 修正のため再度モーダルを開いて 1000円を入力 → 確定
→ 期待: 支払い済みのまま金額が 1000円に更新される
→ 実際: 支払いチェックが外れ「未登録」表示になる（金額は 1000 として保存されるが
  `operationStatus.payment` が false になるため、会計集計から除外される）

## 根本原因

`computeApplyPayment`（`src/services/sessionMutations.ts`）が
`newPayment = !current.payment` という**トグル**実装になっていた。
そのため、支払いモーダルの「確定」ボタンは呼ぶたびに ON/OFF を反転させており、
1回目の確定で ON（登録）、2回目の確定（金額修正のつもり）で OFF（未登録）に
なっていた。

加えて `handlePaymentClick` は常に性別ごとのデフォルト会費を `defaultAmount` に
渡しており、既に入力済みの実際の金額 (`player.paymentAmount`) を初期表示しない
問題もあった（修正のたびに毎回初期値からの入力し直しになっていた）。

## 修正

### `src/services/sessionMutations.ts`
- `computeApplyPayment`: トグルをやめ、常に `payment: true` にする（登録・金額修正の
  一発適用）。`paymentTimestamp` は未払い→支払いへの遷移時のみ更新し、金額修正時は
  元の値を保持する。
- 既存の `computeToggleOperationStatus`（`field: 'payment'` で呼び出す単純トグル）を
  「誤って支払い登録した状態を未登録に戻す」専用の操作として位置づける
  （こちらは金額を変更しない）。JSDoc に用途を明記。

### `src/components/PaymentModal.tsx`
- `isPaid` / `onRevert` prop を追加。
- 支払い登録済みの場合のみ、モーダル下部に「未登録に戻す」リンクボタンを表示。
  「確定」（登録・金額修正）とは明確に分離した操作にすることで誤操作を防止。

### `src/pages/PlayerSelect.tsx` / `src/pages/MainPage.tsx`
- `handlePaymentClick`: `defaultAmount` を `player.paymentAmount ?? 性別デフォルト`
  に変更（既存の入力値を初期表示し、修正しやすくする）。`isPaid` もモーダルへ渡す。
- `paymentRevert`（`useGuardedAction` でラップした
  `writer.toggleOperationStatus(playerId, 'payment')`）を追加し、モーダルの
  「未登録に戻す」から呼び出す。

## テスト

- `src/services/sessionMutations.test.ts`: 「payment ON→OFF（再操作）」テストを
  「支払い済みへの再適用は payment を ON のまま維持し金額のみ更新する」に更新。
  免除（0円）適用時も payment が ON になることを確認するテストを追加。
- `npm run build` / `npm run lint` / `npm run test:run`（418 tests）すべて通過。

## 変更対象

- `src/services/sessionMutations.ts`
- `src/services/sessionMutations.test.ts`
- `src/components/PaymentModal.tsx`
- `src/pages/PlayerSelect.tsx`
- `src/pages/MainPage.tsx`
