# 自動コート数調整

## 概要

参加人数に応じてコート数を自動的に調整（縮小のみ）する機能。
待機人数が少なすぎる（0〜1人）場合、配置の流動性が低下するため、コート数を減らして待機人数を確保する。

## ルール

**原則: `参加人数 - コート数 × 4 ≥ 2` を満たす最大コート数**

| 参加人数 | 推奨コート数 | 待機人数 |
|---------|-----------|---------|
| ~7人    | 1コート    | 1~3人   |
| 8~9人   | 1コート    | 4~5人   |
| 10~11人 | 2コート    | 2~3人   |
| 12~13人 | 2コート    | 4~5人   |
| 14人~   | 3コート    | 2人~    |

## 発動タイミング

1. **セッション開始時**: メンバー入力後、コート数を自動設定（手動選択より優先）
2. **セッション中**: プレイヤーが休憩に入った時、アクティブ人数でコート数を再判定→自動縮小

## 動作仕様

- **縮小のみ**: コート数は自動で減らすのみ。増やすのは手動（体育館のコート数は変わらないため）
- **通知なし**: 無通知で自動調整
- **使用中コート保護**: `resizeCourts()` が使用中コートを優先保持するため、試合中のコートは削除されない

## 実装箇所

### 1. ユーティリティ関数 (`src/lib/utils.ts`)

```typescript
export function getRecommendedCourtCount(playerCount: number, maxCourts: number = 3): number
```

- `playerCount - courts * 4 >= 2` を満たす最大コート数を返す
- `maxCourts` を上限とする
- 最低1コート

### 2. SessionCreate.tsx

- `handleCreate()` / `handleLoadFromSheets()` でセッション作成時に `getRecommendedCourtCount(playerCount, courtCount)` を適用
- ユーザーが選んだ `courtCount` を上限として、推奨コート数を使う

### 3. MainPage.tsx

- `handleToggleRestWithLock()` で休憩設定後にアクティブ人数をチェック
- 推奨コート数が現在のコート数より少なければ `resizeCourts()` と `updateConfig()` を呼ぶ
