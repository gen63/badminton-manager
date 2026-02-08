# 試合履歴削除時の試合回数デクリメント

## 日付: 2026-02-08

## 問題

履歴画面で試合を削除しても、各プレイヤーの `gamesPlayed`（試合回数）がマイナスされない。

### 現状の流れ

1. **試合終了時**（`MainPage.tsx` の `handleFinishGame`）:
   - `gameStore.finishGame()` で `matchHistory` に試合を追加
   - `playerStore.updatePlayer()` で参加した4名の `gamesPlayed` を +1

2. **試合削除時**（`HistoryPage.tsx` の `handleDelete`）:
   - `gameStore.deleteMatch(matchId)` で `matchHistory` から削除
   - **`gamesPlayed` は変更されない** ← バグ

### 影響

- プレイヤーの試合回数表示がずれる
- コート割り当てアルゴリズム（`algorithm.ts`）が `gamesPlayed` を使って優先度を計算しているため、割り当てバランスに影響する

---

## 修正方針

### アプローチ: 削除時に該当プレイヤーの `gamesPlayed` を -1 する

**理由**: 試合追加時に +1 しているので、削除時に -1 するのが対称的で自然。

### 変更対象ファイル

#### 1. `src/pages/HistoryPage.tsx`

`handleDelete` 関数を修正:

```typescript
// Before
const handleDelete = (matchId: string) => {
  deleteMatch(matchId);
};

// After
const handleDelete = (matchId: string) => {
  const match = matchHistory.find((m) => m.id === matchId);
  if (match) {
    // 該当試合の全プレイヤーの gamesPlayed を -1
    [...match.teamA, ...match.teamB].forEach((playerId) => {
      const player = players.find((p) => p.id === playerId);
      if (player && player.gamesPlayed > 0) {
        updatePlayer(playerId, {
          gamesPlayed: player.gamesPlayed - 1,
        });
      }
    });
  }
  deleteMatch(matchId);
};
```

必要な追加インポート:
- `usePlayerStore` から `updatePlayer` を取得（既に `players` は取得済み）

---

## 考慮事項

- `gamesPlayed` が 0 未満にならないよう `player.gamesPlayed > 0` でガード
- `clearHistory()`（設定画面の全リセット）は `clearPlayers()` と同時に呼ばれるため、別途対応不要
- 既に削除済みのプレイヤー（`players` に存在しない）は `find` が `undefined` を返すのでスキップされる

## 影響範囲

- `HistoryPage.tsx` のみ変更
- ストアのインターフェースは変更なし
