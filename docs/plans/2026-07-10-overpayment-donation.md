# 過払い分を「寄付」として会計に反映

日付: 2026-07-10

## 背景・課題

- 標準会費より**少なく**払ったメンバーの差額は「運営協力」として収入のマイナスに
  反映済み（`docs/plans/2026-05-08-cooperation-discount-in-totals.md`）。
- 一方、標準会費より**多く**払うメンバーがいる場合、その超過分は
  `AccountingPage.tsx` の `cooperationDiscount` 計算で `diff > 0` のみ加算する
  ため完全に捨てられており、収入合計が実態より少なく表示される。
- 超過分は「**寄付**」とみなし、収入のプラスとして計算に含める。

## 方針

運営協力と完全に対称な設計にする。

- **寄付 (donation) = Σ max(0, 実支払額 − 標準会費)**
  - 対象: `operationStatus.payment === true` かつ `paymentAmount !== 0`
    （免除は exemptCount で別管理のため除外 — 既存規約を維持）
  - 標準会費: 性別 `F` なら女性会費、それ以外（未設定含む）は男性会費（既存と同じ）
- **incomeTotal = maleTotal + femaleTotal − 運営協力 + 寄付**（純収入）
  - `finalTotal` / `shuttleUsableCount` は incomeTotal 経由で自動的に反映される
- **Firestore には保存しない**: discount と同様、毎回 players から再計算
- **GAS スキーマは変更しない**: 寄付は incomeTotal に溶かし込む
  （独立フィールド化は 2026-05-08 plan の「非対応」節と同様、将来検討）
- **UI**: 収入セクションの「運営協力」行の下に「寄付」行を追加
  （donation > 0 のときのみ表示）。合計式表示にも `+寄付` を追加
- **コピーテキスト**: 運営協力行と対称に寄付行を追加（0 のとき非表示）

## 変更ファイル

1. `src/lib/accountingCalc.ts`
   - `AccountingInputValues.donation?: number`（省略時 0）
   - `AccountingTotals.donation: number`
   - `calculateAccountingTotals`: `incomeTotal = maleTotal + femaleTotal - discount + donation`
   - `buildAccountingCopyText`: 寄付行（収入セクション、運営協力行の下）と合計式
2. `src/pages/AccountingPage.tsx`
   - `cooperationDiscount` の useMemo を拡張し `{ discount, donation }` を
     一度のループで算出（`diff > 0` → discount、`diff < 0` → donation）
   - `calculateAccountingTotals` / `buildAccountingCopyText` に donation を渡す
   - 収入セクションに「寄付」行（緑系/プラス表示、donation > 0 のみ）
   - 合計式表示に `+{donation}`
3. `src/services/sessionService.ts`
   - 重複実装されている派生 incomeTotal 計算にも donation を対称に追加
4. テスト
   - `src/lib/accountingCalc.test.ts`: donation の合計反映・コピーテキスト
     （表示・非表示・discount との併存）
   - `sessionService` の派生 incomeTotal 計算のテスト追加（従来テスト不在の盲点）

## 非対応（将来検討）

- GAS シートへの `donation` 独立フィールド送信（シート側スキーマ変更が前提）
- 寄付者個人の記録・表示（現状は合計金額のみ）
