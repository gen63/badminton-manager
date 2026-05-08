# 運営協力割引を会計合計に反映する

## 背景・課題

会計ページの「入力」タブでは、収入合計を `男性数×男性会費 + 女性数×女性会費`
で算出している。しかし「支払い」タブで個別プレイヤーが標準会費より安い金額
（運営協力で割引）を入力していても、その差額が入力タブの**収入合計** /
**最終合計**に反映されていなかった。

例: 男性会費 800 / 女性会費 600、男2 女1、しかし男のうち1人が運営協力で 600 入力
- 期待合計: 800 + 600 + 600 = 2000
- 表示合計: 800×2 + 600×1 = 2200（実態より 200 多い）

## 方針

ユーザー確認済み（差額を自動算出して表示方式）:

- 標準計算 (`maleCount × maleFee + femaleCount × femaleFee`) と
  支払いタブで集計された実支払額の差を **運営協力割引** として支出側に表示
- 最終合計 = `incomeTotal - gymCost - shuttleTotal - discount + otherAmount`

## 詳細設計

### 1. 割引額の算出（AccountingPage 側で計算）

支払いタブで `payment === true` かつ `paymentAmount > 0` のプレイヤーについて、
標準会費との差額を合計する。免除（`paymentAmount === 0`）は exemptCount で
別途扱われているので除外。性別未設定は男性扱い（既存ロジックと整合）。

```ts
const cooperationDiscount = useMemo(() => {
  const paidPlayers = players.filter(p => p.operationStatus?.payment);
  let total = 0;
  for (const p of paidPlayers) {
    const actual = p.paymentAmount ?? 0;
    if (actual === 0) continue; // 免除
    const expectedFee = p.gender === 'F' ? femaleFee : maleFee;
    const diff = expectedFee - actual;
    if (diff > 0) total += diff;
  }
  return total;
}, [players, maleFee, femaleFee]);
```

### 2. 計算ロジック（accountingCalc.ts）

純粋関数の入出力を拡張:

- `AccountingInputValues` に `discount?: number` を追加（省略時は 0）
- `AccountingTotals` に `discount: number` を追加
- `finalTotal = incomeTotal - gymCost - shuttleTotal + otherAmount - discount`
- `shuttleUsableCount` は黒字計算なので `discount` も差し引く

### 3. UI 表示

支出セクションのシャトル使用数の下に「運営協力」行を追加:

```
支出
  体育館       -900
  シャトル     -29,760  (510 × 62)
  運営協力     -600       ← 新規（discount > 0 のときのみ）
```

合計式の表示も更新:
`maleTotal + femaleTotal - gymCost - shuttleTotal - discount [+otherAmount]`

### 4. コピーテキスト（buildAccountingCopyText）

- 支出ブロックに `運営協力 -X` を追加（discount > 0 のとき）
- 合計の式に `-{discount}` を追加

### 5. AccountingCalcPage への影響

支払いデータを持たないので `discount` は省略（= 0）。既存挙動と完全互換。

## 影響範囲

- `src/lib/accountingCalc.ts`
- `src/pages/AccountingPage.tsx`
- `src/lib/accountingCalc.test.ts`（discount ケース追加）

## 非対応（将来検討）

- アップロードする会計レコード (`AccountingRecord`) には今回 `discount` を
  保存しない（GAS シート側のスキーマ変更が必要なため）。実態合計は
  `finalTotal - discount` として残るが、内訳としての discount は持たない。
