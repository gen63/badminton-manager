# 待機メンバーのソート順を配置優先度順に変更

**日付**: 2026-02-07
**ステータス**: 実装済み

---

## 背景・課題

現在、待機メンバーリスト（MainPage.tsx）は `gamesPlayed` 昇順でソートされている。

しかし、「一括配置」ボタンを押した時にコートに入る順番は以下2つの要素で決まる：

1. **優先スコア** (`calculatePriorityScore`)：スコアが低い人ほど優先
2. **グループ制約** (3コート時)：`prob === 0` のコートには配置不可

### 問題1: 優先スコアとの乖離

| 設定 | 優先スコア | UI表示との乖離 |
|------|-----------|---------------|
| OFF | `gamesPlayed` | 一致（現状通り） |
| ON | `gamesPlayed / max(stayMinutes, 5)` | **乖離あり** |

### 問題2: グループ制約の未反映（3コート運用）

```
確率テーブル（prob=0 は配置不可）:

         C1    C2    C3
upper:  0.00  0.50  0.50   ← C1に入れない
middle: 0.25  0.50  0.25   ← 全コートOK
lower:  0.50  0.00  0.50   ← C2に入れない
```

空いたコートが C2 の場合、lowerグループの人は優先スコアが高くても配置されない。
UIでは上位に表示されるのに実際には配置されず、直感に反する。

## 変更方針：アプローチA（動的ソート）

空きコートに応じて、eligible（配置可能）な人を上位にソート。

### ソートロジック

1. 空きコートのIDを取得
2. 3コート時：各待機メンバーのグループ(upper/middle/lower)を判定
3. 空きコートに対して `prob > 0` のメンバーを「eligible」とする
4. eligible な人を優先スコア昇順で上位に、ineligible な人を下位に配置

## 変更対象ファイル

### 1. `src/lib/algorithm.ts`
- `sortWaitingPlayers()` 関数を新規追加・export
  - 空きコートID、全アクティブプレイヤー、設定等を受け取る
  - 3コート時：`groupPlayers3Court()` でグループ判定し、eligibility を計算
  - 3コート未満 or 空きコートなし：優先スコア順のみ

### 2. `src/pages/MainPage.tsx`
- `sortWaitingPlayers` をインポート
- ソート処理を差し替え（空きコート・グループ考慮）

## 実装詳細

### 変更前（MainPage.tsx）
```typescript
const activePlayers = players
  .filter((p) => !p.isResting && !playersInCourts.has(p.id))
  .sort((a, b) => a.gamesPlayed - b.gamesPlayed);
```

### 変更後（MainPage.tsx）
```typescript
const waitingPlayersUnsorted = players
  .filter((p) => !p.isResting && !playersInCourts.has(p.id));

const activePlayers = sortWaitingPlayers(waitingPlayersUnsorted, {
  emptyCourtIds: courts.filter(c => !c.teamA[0] || c.teamA[0] === '').map(c => c.id),
  totalCourtCount: courts.length,
  matchHistory,
  allActivePlayers: players.filter(p => !p.isResting),
  practiceStartTime: session?.config.practiceStartTime ?? Date.now(),
  useStayDuration: useStayDurationPriority,
});
```

### sortWaitingPlayers（algorithm.ts）
- 空きコートなし or 3コート未満 → 優先スコア順のみ
- 3コート時 → `groupPlayers3Court()` でグループ分け → eligible判定 → eligible優先でソート
