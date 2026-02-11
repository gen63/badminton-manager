# コート配置の固定化 (upper→C1, middle→C2, lower→C3)

**日付**: 2026-02-10
**対象**: `src/lib/algorithm.ts`
**構成**: 3コート、14-21人

---

## やること

### 1. 確率テーブルを完全固定に変更

```typescript
// Before
upper:  [0.00, 0.50, 0.50]   ← コートがバラける
middle: [0.25, 0.50, 0.25]
lower:  [0.50, 0.00, 0.50]

// After
upper:  [1.00, 0.00, 0.00]   ← upper→C1 固定
middle: [0.00, 1.00, 0.00]   ← middle→C2 固定
lower:  [0.00, 0.00, 1.00]   ← lower→C3 固定
```

### 2. 借用フォールバックを追加

homeグループ内で `selectBestFour` が有効な4人組を見つけられない場合、
**隣接グループの序列境界から1人ずつ候補を追加**して再探索する。

借用の優先順位:
- **C1(upper)**: middle上位から
- **C2(middle)**: upper下位 + lower上位から交互に
- **C3(lower)**: middle下位から

### 3. 敗北時に序列を下げる

現行は敗北時に序列が動かない → コート固定化で閉塞感が出る。

```typescript
// dropAmount = ceil(groupSize / 2)
// 21人(gs=7) → drop=4、18人(gs=6) → drop=3、14人(gs=4) → drop=2
```

| 位置 | 挙動 |
|------|------|
| グループ上位（#1-#3） | 1敗で残留、**2敗で降格** |
| グループ下位（#4-#7） | **1敗で即降格** |

勝敗の非対称性:

| | 上昇 | 降下 |
|---|---|---|
| 通常 | 1勝 → 1つ上 | 1敗 → ceil(gs/2)下 |
| 連続 | 2連勝 → groupSize分ジャンプ | 2連敗 → 確実に降格 |

### 4. sortWaitingPlayers の調整

homeコートが空いているかで eligible 判定:

```typescript
const eligible = emptyCourtIds.some(courtId => {
  const prob = COURT_PROBABILITIES_3[group]?.[courtId - 1] ?? 0;
  return prob >= 0.5;
});
```

### 5. hasIsolatedExtreme は維持

借用発生時のスキルバランス保護として引き続き有効。

---

## シミュレーション結果（21人、100回平均、20ラウンド）

| 指標 | 現行 | 借用+敗北降下 |
|------|------|-------------|
| crossGroup/240配置 | 183回(76%) | **0回(0%)** |
| deadlock | 0 | **0** |
| grpChange/20R | - | **85.1** (1R約4.3人がグループ移動) |
| 対戦相手数(avg) | - | **16.4人/21人中** |
| 公平性(stddev) | 0.49 | **0.53** |

---

## 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `src/lib/algorithm.ts` | 確率テーブル変更 |
| `src/lib/algorithm.ts` | 借用フォールバック追加（assignCourts） |
| `src/lib/algorithm.ts` | 敗北時降下追加（applyStreakSwaps） |
| `src/lib/algorithm.ts` | sortWaitingPlayers 判定調整 |
| `src/lib/algorithm.test.ts` | テスト更新 |

変更不要: `selectBestFour`, `formTeams`, `assign2CourtsHolistic`, `hasIsolatedExtreme`, `getGenderPenalty`

---

## リスク

1. **14-15人**: グループ4-5人で少数のデッドロック残存 → 最終フォールバック（制約無視）で対応
2. **性別3-1率**: 女性3割時に現行0%→22%（プール7人の数学的制約）
3. **序列変動の振れ幅**: 敗北降下が強いため、1セッション中にコートが頻繁に変わる可能性 → これは閉塞感打開の裏返し

---

## シミュレーションスクリプト

`scripts/simulate-court-assignment.ts` に検証コードを配置。

```bash
npx tsx scripts/simulate-court-assignment.ts
```
