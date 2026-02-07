# 待機メンバーのソート順を配置優先度順に変更

**日付**: 2026-02-07
**ステータス**: 計画中

---

## 背景・課題

現在、待機メンバーリスト（MainPage.tsx:169）は `gamesPlayed` 昇順でソートされている。

```typescript
.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
```

しかし、「一括配置」ボタンを押した時にコートに入る順番は `calculatePriorityScore()` で決まる。このスコアは `useStayDurationPriority` 設定によって以下のように変わる：

| 設定 | 優先スコア | UI表示との乖離 |
|------|-----------|---------------|
| OFF | `gamesPlayed` | 一致（現状通り） |
| ON | `gamesPlayed / max(stayMinutes, 5)` | **乖離あり** |

特にONの場合、「長く滞在しているが試合数が少ない人」がアルゴリズム的には優先されるのに、UIには `gamesPlayed` の低い順に表示されるため、実際の配置順と見た目が一致しない。

**→ 待機リストの表示順をアルゴリズムの配置優先度と一致させたい。**

## 前提

- レートは全員未設定（同一グループ扱い）と仮定
- レートが異なる場合のグループ分けは表示順に影響しない（グループ分けはコート振り分け時の話で、「誰が先にコートに入るか」は優先スコアで決まる）

## 変更方針

### 変更の本質

待機メンバーの表示ソートを `gamesPlayed` 昇順 → `calculatePriorityScore()` 昇順に変更する。

### 変更対象ファイル

#### 1. `src/lib/algorithm.ts`
- `calculatePriorityScore()` を `export` する（現在は非公開）

#### 2. `src/pages/MainPage.tsx`
- 待機メンバーのソート処理を変更
- `calculatePriorityScore()` をインポート
- `useSessionStore` から `practiceStartTime` を取得（既に使用中か確認）
- `useSettingsStore` から `useStayDurationPriority` を取得（既に使用中か確認）

### 変更前

```typescript
const activePlayers = players
  .filter((p) => !p.isResting && !playersInCourts.has(p.id))
  .sort((a, b) => a.gamesPlayed - b.gamesPlayed);
```

### 変更後

```typescript
const activePlayers = players
  .filter((p) => !p.isResting && !playersInCourts.has(p.id))
  .sort((a, b) =>
    calculatePriorityScore(a, practiceStartTime, useStayDurationPriority)
    - calculatePriorityScore(b, practiceStartTime, useStayDurationPriority)
  );
```

## 動作の違い

### 例: 3人が待機中（滞在時間考慮ON）

| プレイヤー | 試合数 | 滞在時間 | 優先スコア | 変更前の順位 | 変更後の順位 |
|-----------|--------|---------|-----------|------------|------------|
| Aさん | 2 | 60分 | 0.033 | 1位 | 1位 |
| Bさん | 3 | 120分 | 0.025 | 2位 | **1位** ← |
| Cさん | 4 | 30分 | 0.133 | 3位 | 3位 |

→ Bさんは試合数が多いが滞在時間が長いため、スコアが低い＝優先度が高い。変更後はBさんが上に来る。

### `gamesPlayed === 0` のプレイヤー

どちらのモードでも最上位に表示される（`-Infinity`）。現行動作と同じ。

## 実装手順

1. `algorithm.ts` の `calculatePriorityScore` を `export` に変更
2. `MainPage.tsx` で `calculatePriorityScore` をインポートし、ソートロジックを差し替え
3. `practiceStartTime` と `useStayDurationPriority` が既にスコープ内にあるか確認し、なければ取得
4. ビルド確認 (`npm run build`)

## リスク・考慮事項

- **滞在時間考慮OFF時**: `calculatePriorityScore` は単に `gamesPlayed` を返すため、現行動作と完全一致。リグレッションなし。
- **`practiceStartTime` 未設定時**: `calculatePriorityScore` 内で `Date.now()` にフォールバック。問題なし。
- **パフォーマンス**: ソート関数内で `Date.now()` を呼ぶが、プレイヤー数は高々数十人なので無視できる。
