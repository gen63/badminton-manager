# 会計の合計金額算出：メンバー入力金額ベースへの改善

## Context
現在の会計システムでは、収入合計を `男人数×男会費 + 女人数×女会費` という計算式で算出している。しかし実際には個別のメンバーが異なる金額を支払うケースがある（免除¥0、金額調整など）。メンバーが1人でも支払い金額を入力・確定した場合、その入力金額を基準にしたハイブリッド計算に切り替え、より正確な会計を実現する。

また、免除（¥0）を明確に入力・確定した場合、そのメンバーの支払いタスクは完了とみなす。

## 方針: ハイブリッド方式
- **入力済みメンバー**: 確定した `paymentAmount` をそのまま使用（¥0含む）
- **未入力メンバー**: 従来の計算式（性別×単価）で算出
- 全員未入力の場合は従来通りの計算式のみ

## 変更対象ファイル

### 1. `src/pages/AccountingPage.tsx`

#### 1a. ハイブリッド収入計算の追加（`paymentStats` useMemo付近）

新しい `useMemo` を追加して、ハイブリッド収入を計算する：

```typescript
const hybridIncome = useMemo(() => {
  const paidPlayers = players.filter(p => p.operationStatus?.payment);

  if (paidPlayers.length === 0) {
    // 誰も入力していない → 従来の計算式
    return {
      useHybrid: false,
      total: maleCount * maleFee + femaleCount * femaleFee,
      paidTotal: 0,
      unpaidTotal: maleCount * maleFee + femaleCount * femaleFee,
      paidCount: 0,
    };
  }

  // 入力済みメンバーの合計
  const paidTotal = paidPlayers.reduce((sum, p) => sum + (p.paymentAmount ?? 0), 0);

  // 未入力メンバーの推定（入力タブの人数から入力済み人数を引く）
  // 入力済みの男女内訳を計算
  const paidMaleCount = paidPlayers.filter(p => p.gender === 'M' || !p.gender).length;
  const paidFemaleCount = paidPlayers.filter(p => p.gender === 'F').length;

  const unpaidMaleCount = Math.max(0, maleCount - paidMaleCount);
  const unpaidFemaleCount = Math.max(0, femaleCount - paidFemaleCount);
  const unpaidTotal = unpaidMaleCount * maleFee + unpaidFemaleCount * femaleFee;

  return {
    useHybrid: true,
    total: paidTotal + unpaidTotal,
    paidTotal,
    unpaidTotal,
    paidCount: paidPlayers.length,
  };
}, [players, maleCount, femaleCount, maleFee, femaleFee]);
```

**注意**: 未入力人数の算出は、入力タブの男女人数から支払い済みの男女人数を引く。ただし免除人数は入力タブの免除カウントに含まれるため、免除で¥0確定した人は未入力側には含まれない（支払い済みとして扱われる）。

#### 1b. `finalTotal` の計算を修正

```typescript
// Before:
const finalTotal = maleTotal + femaleTotal - gymCost - shuttleTotal + otherAmount;

// After:
const incomeForTotal = hybridIncome.total;
const finalTotal = incomeForTotal - gymCost - shuttleTotal + otherAmount;
```

`maleTotal` / `femaleTotal` は収入セクションの表示用にそのまま残す。

#### 1c. 合計セクションのUI修正

合計カードに「メンバー入力反映中」の表示を追加：
- `hybridIncome.useHybrid` が true の場合、計算式の上にバッジ表示
- 計算式の表示も変更（入力済み合計 + 未入力推定 - 支出）

#### 1d. コピーテキスト（`generateCopyText`）の修正

ハイブリッドモード時のコピーテキストに、入力済み合計と未入力推定を含める：
```
【収入】
支払い入力済み(3人) = 2,400
未入力分 男800×2 + 女600×1 = 2,200
```

#### 1e. アップロード時の `incomeTotal` を修正

```typescript
const incomeTotal = hybridIncome.total;
```

### 2. 免除¥0の支払い完了表示

現状の動作確認：
- PaymentModalで「免除（¥0）」→「確定」すると `setPaymentAmount(id, 0)` + `toggleOperationStatus(id, 'payment')` が呼ばれる
- `operationStatus.payment = true` になるので**既に完了扱い**
- `paymentAmount || 0` は ¥0 を正しく 0 として扱う（`|| 0` は undefined/null 対策であり、0は0のまま通る...実際には `0 || 0 = 0` なので問題ない）

**追加変更なし** - 現在の実装で免除¥0は正しく完了タスクとして扱われている。ただし `paymentAmount || 0` を `paymentAmount ?? 0` に変更すべき（意味の明確化。`0 || 0` は結果的に同じだが、`??` の方が意図が明確）。

## 実装手順

1. **AccountingPage.tsx** に `hybridIncome` useMemo を追加
2. `finalTotal` 計算を `hybridIncome.total` ベースに変更
3. 合計セクションのUIにハイブリッドモード表示を追加
4. `generateCopyText()` をハイブリッド対応に修正
5. `handleUpload()` の `incomeTotal` をハイブリッド対応に修正
6. `paymentAmount || 0` → `paymentAmount ?? 0` に変更（AccountingPage.tsx内）

## 検証方法

1. `npm run build` でビルド成功を確認
2. `npm run lint` でlintエラーなしを確認
3. `npm run test:run` でテスト通過を確認
4. 手動テストシナリオ:
   - 誰も支払い入力していない → 従来の計算式で合計表示
   - 1人だけ支払い入力 → ハイブリッド計算で合計表示、バッジ表示あり
   - 免除¥0で確定 → 支払い完了として扱われる、合計に¥0が反映
   - コピーテキストがハイブリッドモードを反映
