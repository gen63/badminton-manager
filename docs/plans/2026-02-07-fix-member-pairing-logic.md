# formTeams ペアリングロジック修正 — 最強+最弱ペアリング

**日付**: 2026-02-07
**対象**: `src/lib/algorithm.ts` の `formTeams` 関数

---

## 仕様の明確化

### ペア・対戦の重複に対する考え方

| 状況 | OK? | 理由 |
|------|-----|------|
| 同じ人と連続でペアを組む | **OK** | ペア被りは問題ない |
| 同じペアで異なる相手と対戦 | **OK** | 相手が違えば問題ない |
| 1人から見て他3人が直近と同じ | **NG** | 同じメンツ感が出る |
| 同じ4人が再度同じコートに入る | **NG** | 上記の最悪ケース |

### 既存の抑止ロジック検証: `hasSimilarRecentMatch`

`selectBestFour` (個別配置) / `tryFixRecentMatch` (2コート同時) で使用。

```
4人 = [A, B, C, D] のそれぞれについて直近2試合を調べる:
  overlap = その試合の4人 ∩ 今回の4人
  overlap >= 3 → NG（その組み合わせは不採用）
```

overlapには本人を含むため:
- overlap=4: 全く同じ4人 → **NG** ✓
- overlap=3: 本人+他2人が同じ試合 → **NG** ✓
- overlap=2: 本人+他1人のみ → OK

→ **「1人から見て他3人のうち2人以上が直近試合にいた」ケースは `selectBestFour` の段階で既にブロック済み。**
→ `formTeams`（4人確定後のペア分け）で履歴を二重チェックする必要はない。

### あるべきペアリング

4人の中で序列順に並べた場合（1=最強, 4=最弱）:

```
序列: [1, 2, 3, 4]
正しいペアリング: 1-4 vs 2-3（最強+最弱 vs 中間2人）
```

---

## 現状の問題

### 現在の `formTeams` (algorithm.ts:298-334)

3つのペアリングパターンを試し、履歴ペナルティが最小のものを選択:

```
スコア:
  同チーム履歴（pairHistory）   → +10  ← 不要
  対戦履歴（opponentHistory）  → +5×4 ← 不要
```

### 問題点

1. **`pairHistory` ペナルティ (+10)**: 仕様上、同じペアは問題ない → **削除すべき**
2. **`opponentHistory` ペナルティ (+5)**: 4人はすでに確定済み。どう組んでも相手は残り2人。3人以上の重複は `selectBestFour` / `tryFixRecentMatch` が既に防止 → **削除すべき**
3. **スキルバランス**: 最強+最弱ペアリングのロジックが欠落 → **追加すべき**

---

## 修正方針

### `formTeams` をシンプル化: 序列ベースの固定ペアリング

履歴ペナルティを全て削除し、序列のみでペアリングを決定する。

```
入力: 4人 + 序列情報（playerOrder: string[]）
処理:
  1. 4人を序列順にソート → [1位, 2位, 3位, 4位]
  2. 固定で 1位+4位 vs 2位+3位 を返す
```

3パターン探索も不要。序列でソートして最強+最弱をペアにするだけ。

### 序列が同じ場合（全員未レート等）

序列上の位置が同じ場合は、どのペアリングでも実力差がないため、
`playerOrder` 内の相対順序で決まる（事実上ランダム）。問題なし。

---

## 修正対象

### 1. `formTeams` 関数 (algorithm.ts:298-334)

**変更内容**:
- 引数を `(fourPlayers: Player[], playerOrder: string[])` に変更
- `pairHistory`, `opponentHistory` 引数を削除
- 4人を `playerOrder` 内の順番でソート
- 1位+4位 vs 2位+3位 を返す

### 2. `formTeams` の呼び出し元（3箇所）

| 行番号 | 呼び出し元 | 変更内容 |
|-------|-----------|---------|
| 425 | `assign2CourtsHolistic` (upperCourt) | `order` を渡す（計算済み） |
| 426 | `assign2CourtsHolistic` (lowerCourt) | `order` を渡す（計算済み） |
| 649 | `assignCourts` メインフロー | `order` を計算して渡す |

### 3. 不要コードの削除

- `getPairHistory` / `getOpponentHistory` が `formTeams` 以外で使われていなければ削除
- `assignCourts` / `assign2CourtsHolistic` 内の `pairHistory` / `opponentHistory` 変数の削除

### 4. `assignCourts` 内での序列情報の取得

`assignCourts` ではすでに `groupingPlayers`（全アクティブプレイヤー）が利用可能。
`buildInitialOrder` + `applyStreakSwaps` で序列を計算して `formTeams` に渡す。

`assign2CourtsHolistic` ではすでに `order` が計算済み（line 396）。そのまま渡せる。

---

## 影響範囲

- `formTeams` のペアリング結果が変わる（履歴ベース → 序列ベース）
- 配置アルゴリズムの他の部分（selectBestFour, グループ分け等）には影響なし
- 不要な履歴計算の削除によりコードがシンプルになる

---

## テスト確認

- `npm run build` でビルド通ること
- 4人選出後のペアリングが「序列1位+4位 vs 2位+3位」になること
