# 優先度システムの簡素化: 待機時間 × レーティング × 序列のハイブリッド

**日付**: 2026-02-08
**ステータス**: 実装中

---

## 背景・課題

現在の優先度計算 (`calculatePriorityScore`) は「プレイ密度」ベース:

```
score = gamesPlayed / max(stayMinutes, 5)
```

- 複雑で直感的でない
- `useStayDurationPriority` トグルで2モード管理が必要
- `oneGameDelta` スケーリングによるコートペナルティも複雑

→ **「最後の試合からの待ち時間」をベースにした、シンプルで直感的な優先度**に置き換える。

---

## 設計方針: 関心の分離

| 判断 | 決定要因 | 仕組み |
|------|---------|--------|
| **誰が次に試合するか** | 待機時間（公平性） | `calculatePriorityScore` |
| **どのコートに入るか** | レーティンググループ（実力バランス） | `groupPlayers3Court` / eligibility |
| **誰とチームを組むか** | 序列（競技バランス） | `formTeams` |

レーティング・序列・待機時間がそれぞれ異なる役割を持ち、ハイブリッドに機能する。

---

## 変更内容

### 1. `calculatePriorityScore` の簡素化

**Before:**
```typescript
function calculatePriorityScore(player, practiceStartTime, useStayDuration) {
  if (player.gamesPlayed === 0) return -Infinity;
  if (!useStayDuration) return player.gamesPlayed;
  const stayMinutes = max((now - max(practiceStartTime, activatedAt)) / 60000, 5);
  return player.gamesPlayed / stayMinutes;
}
```

**After:**
```typescript
function calculatePriorityScore(player: Player): number {
  if (player.gamesPlayed === 0) return -Infinity;
  const now = Date.now();
  const waitingSince = player.lastPlayedAt ?? player.activatedAt ?? now;
  const waitMinutes = (now - waitingSince) / (1000 * 60);
  return -waitMinutes;  // 待ちが長い = 値が小さい = 優先度高
}
```

- パラメータ不要（`practiceStartTime`, `useStayDuration` 削除）
- 直感的: 待ちが長い人ほど優先

### 2. コート適性ペナルティの簡素化

**Before:**
```typescript
oneGameDelta = useStayDuration ? 1/stayMinutes : 1.0;
penalty = Math.random() * (1 - courtProb) * oneGameDelta;
```

**After:**
```typescript
const COURT_SWAP_THRESHOLD_MINUTES = 5;
penalty = Math.random() * (1 - courtProb) * COURT_SWAP_THRESHOLD_MINUTES;
```

- 待機時間差が約5分以内の人同士は、コート適性で入替可能
- `oneGameDelta` スケーリング不要

### 3. 削除する設定・オプション

| 項目 | 理由 |
|------|------|
| `useStayDurationPriority` (settingsStore) | 2モード管理が不要に |
| `useStayDurationPriority` toggle (SettingsPage) | UI不要に |
| `practiceStartTime` (assignCourts options) | 優先度計算に不要 |
| `useStayDurationPriority` (MainPage → assignCourts) | パススルー不要に |

### 4. 維持する仕組み

- レーティンググループ（upper/middle/lower）
- コートeligibility（prob=0除外）
- ストリーク序列（applyStreakSwaps）
- 直近試合重複回避
- 上位/下位孤立回避
- チーム編成（最強+最弱ペア）
- 2コートホリスティック配置

---

## 変更対象ファイル

1. `src/lib/algorithm.ts` - コアロジック簡素化
2. `src/stores/settingsStore.ts` - `useStayDurationPriority` 削除
3. `src/pages/SettingsPage.tsx` - トグルUI削除
4. `src/pages/MainPage.tsx` - 参照削除
5. `src/lib/algorithm.test.ts` - テスト更新

---

## トレードオフ

| 観点 | 旧方式（密度ベース） | 新方式（待機時間ベース） |
|------|---------------------|------------------------|
| 累積的公平性 | ○ 全体の試合密度を見る | △ 直近の待ち時間のみ |
| 直感性 | △ 計算が複雑 | ○ 「長く待ってる人が先」 |
| 設定の複雑さ | 2モード管理 | 設定不要 |
| 実運用での差 | — | ほとんどの場面で同等の結果 |
