# 参加者管理画面のソート順を動的序列（昇順）に変更

**日付**: 2026-02-07
**ステータス**: 実装中

---

## 背景・課題

設定画面 → 「参加者を管理」で開く PlayerSelect 画面では、メンバーが**追加順**で表示されている。
試合結果に基づく動的な序列（弱い順 → 強い順）でソートしたい。

## 既存の動的序列の仕組み

1. `buildInitialOrder()` — 初期レーティング降順で序列構築（強い順）
2. `applyStreakSwaps()` — 勝敗で序列更新:
   - 勝利: 1つ上に移動
   - 2連勝ごと: グループ1つ分上にジャンプ
   - 敗北: 移動なし（相対的に下がる）

序列のインデックスが小さい = 強い。表示は**逆順（昇順 = 弱い→強い）**にする。

## 設計方針

### ソートルール

1. `buildInitialOrder()` → `applyStreakSwaps()` で動的序列を取得
2. 序列を**逆順**にして表示（弱い順 → 強い順 = レーティング昇順）
3. 序列に含まれないプレイヤー（新規追加直後等）は末尾に配置

### データ取得

- `players`: `usePlayerStore` から（既存）
- `matchHistory`: `useGameStore` から追加で取得
- `buildInitialOrder`, `applyStreakSwaps`: `algorithm.ts` からインポート

## 変更対象

### `src/pages/PlayerSelect.tsx`

```tsx
import { useGameStore } from '../stores/gameStore';
import { buildInitialOrder, applyStreakSwaps } from '../lib/algorithm';

// 動的序列でソート（弱い順 = 序列の逆順）
const { matchHistory } = useGameStore();
const dynamicOrder = applyStreakSwaps(buildInitialOrder(players), matchHistory, 3);

const sortedPlayers = [...players].sort((a, b) => {
  const aIdx = dynamicOrder.indexOf(a.id);
  const bIdx = dynamicOrder.indexOf(b.id);
  // 序列にない場合は末尾
  const aPos = aIdx === -1 ? Infinity : aIdx;
  const bPos = bIdx === -1 ? Infinity : bIdx;
  // 逆順（序列末尾=弱い が先に表示）
  return bPos - aPos;
});
```

## 影響範囲

- PlayerSelect.tsx のみ
- ストアの配列順序は変更しない（表示時のみ）
- algorithm.ts の関数を参照するのみ（変更なし）

## テスト観点

- 試合結果なし → 初期レーティング昇順で表示
- 試合結果あり → 勝者が上位（末尾側）に移動
- 序列に含まれないプレイヤーが末尾に表示
- メンバーの追加・削除が正常動作
- ビルド成功 (`npm run build`)
