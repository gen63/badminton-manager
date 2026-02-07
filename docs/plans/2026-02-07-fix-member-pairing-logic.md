# formTeams ペアリングロジック修正 — 最強+最弱ペアリング

**日付**: 2026-02-07
**対象**: `src/lib/algorithm.ts` の `formTeams` 関数

---

## 現状の問題

### 現在の `formTeams` の動作

4人が選出された後、3つのペアリングパターンを試し、**ペア履歴・対戦履歴のペナルティが最も少ないもの**を選んでいる。

```
4人 = [A, B, C, D]

パターン1: A-B vs C-D
パターン2: A-C vs B-D
パターン3: A-D vs B-C

スコア:
  同チーム履歴 → +10
  対戦履歴     → +5（×4組）

→ 最小スコアを選択
```

**問題**: スキルレベル（序列）が一切考慮されていない。そのため、強い者同士・弱い者同士がペアになる可能性がある。

### あるべき仕様

4人の中で序列順に並べた場合（1=最強, 4=最弱）:

```
序列: [1, 2, 3, 4]
正しいペアリング: 1-4 vs 2-3 （最強+最弱 vs 中間2人）
```

これによりチーム力が均衡する。

---

## 修正方針

### 案: 序列ベースのペアリング優先 + 履歴ペナルティの併用

1. `formTeams` に序列情報（`playerOrder: string[]`）を追加パラメータとして渡す
2. 4人を序列順にソート
3. 3つのペアリングパターンに対して、序列バランスペナルティを導入

### スコア計算の変更

```
現在:
  score = pairHistoryPenalty + opponentHistoryPenalty

変更後:
  score = skillImbalancePenalty + pairHistoryPenalty + opponentHistoryPenalty
```

#### skillImbalancePenalty の計算

4人を序列順に [1位, 2位, 3位, 4位] とソートした場合:

- **1位+4位 vs 2位+3位** → skillImbalancePenalty = 0 （理想のペアリング）
- **1位+2位 vs 3位+4位** → skillImbalancePenalty = 大きい値
- **1位+3位 vs 2位+4位** → skillImbalancePenalty = 中程度の値

具体的には、各チームの序列合計の差をペナルティとする:

```
teamASum = チームAメンバーの序列合計
teamBSum = チームBメンバーの序列合計
skillImbalancePenalty = |teamASum - teamBSum| × 重み

例（4人の序列 = [0, 1, 2, 3]）:
  1位+4位 vs 2位+3位 → |0+3 - (1+2)| = 0 → ペナルティ = 0
  1位+3位 vs 2位+4位 → |0+2 - (1+3)| = 2 → ペナルティ = 2 × 重み
  1位+2位 vs 3位+4位 → |0+1 - (2+3)| = 4 → ペナルティ = 4 × 重み
```

重み = 20（ペア履歴10より優先させるため）

→ これにより、序列バランスが最重要、次にペア履歴、最後に対戦履歴の優先度になる。

---

## 修正対象

### 1. `formTeams` 関数 (algorithm.ts:298-334)

**変更内容**:
- 引数に `playerOrder: string[]` を追加
- 4人を `playerOrder` 内の順番でソート
- 各パターンの score に `skillImbalancePenalty` を加算

### 2. `formTeams` の呼び出し元（3箇所）

| 行番号 | 呼び出し元 | 変更内容 |
|-------|-----------|---------|
| 425 | `assign2CourtsHolistic` (upperCourt) | `order` を渡す |
| 426 | `assign2CourtsHolistic` (lowerCourt) | `order` を渡す |
| 649 | `assignCourts` メインフロー | `order` を計算して渡す |

### 3. `assignCourts` 内での序列情報の取得

`assignCourts` ではすでに `groupingPlayers`（全アクティブプレイヤー）が利用可能。
`buildInitialOrder` + `applyStreakSwaps` で序列を計算して `formTeams` に渡す。

`assign2CourtsHolistic` ではすでに `order` が計算済み（line 396）。そのまま渡せる。

---

## 影響範囲

- `formTeams` のペアリング結果が変わる
- 配置アルゴリズムの他の部分（selectBestFour, グループ分け等）には影響なし
- 既存のペア履歴・対戦履歴の考慮は維持（副次的要素として残る）

---

## テスト確認

- `npm run build` でビルド通ること
- 4人選出後のペアリングが「序列1位+4位 vs 2位+3位」になることを確認
- 序列情報が同じ（全員未レート）の場合、従来通り履歴ベースで決まること
