# 予約機能（Reservation Feature）

## 日付: 2026-03-06

## 概要

メイン画面に「予約」ボタンを追加し、特定メンバーの組み合わせを優先的にまとめて配置する機能。
試合に出場予定のペアを優先的に組ませる等のユースケースに対応する。

---

## 確定仕様

### 基本ルール

| 項目 | 仕様 |
|------|------|
| 予約人数 | 1〜4人 |
| 1人予約 | 次の配置で最優先で選ばれる |
| 2人予約 | 同じチーム（ペア）として配置 |
| 3人予約 | 最初に選ばれた2人がペア、3人目はもう1人と別ペア |
| 4人予約 | 最初の2人がペア、残り2人がペア（同コート対戦） |
| 配置条件 | 予約メンバー全員が待機状態になるまで配置されない |
| 予約専用待機 | 予約メンバーは予約消化まで他の試合に配置**されない** |
| 優先度 | 予約メンバーが揃ったら通常の待機者より優先的に配置 |
| 複数予約の順位 | 作成順（FIFO） |
| プレイヤー重複 | 同じ人が複数予約に含まれてOK |
| 消化後 | 履歴として一覧に残す（ステータス: fulfilled） |

### 重複予約時の動作

- 予約1: A + B、予約2: A + C の場合
- Aは予約1が消化されるまで通常配置されない
- 予約1消化後、Aは予約2の待機に入る
- 予約2も消化されるまでAは通常配置されない

---

## UIフロー

### 1. メイン画面

- ヘッダーエリアに「予約」ボタンを追加（アイコン: CalendarCheck or Bookmark）
- 未消化予約がある場合、バッジで件数を表示

### 2. 予約一覧モーダル

- タイトル: 「予約一覧」
- 未消化の予約一覧（FIFO順）
  - 各予約: メンバー名表示 + ステータス（待機中 / メンバー不足）+ 削除ボタン
- 消化済み予約一覧（折りたたみ or 下部にグレー表示）
- 右下に「+」ボタン（予約追加）

### 3. 予約追加モーダル

- メンバー選択リスト（待機中 + 試合中のメンバーから選択可能）
  - 休憩中（isResting=true）のメンバーは選択不可 or グレーアウト
- 選択済み人数の表示（1〜4人）
- 「OK」ボタン: 1人以上選択で有効化
- 「キャンセル」ボタン: 常に有効

---

## 実装計画

### Step 1: 型定義（types/reservation.ts）

```typescript
interface Reservation {
  id: string;
  playerIds: string[];          // 1〜4人のプレイヤーID
  status: 'pending' | 'fulfilled';
  createdAt: number;
  fulfilledAt: number | null;
}
```

### Step 2: Zustandストア（stores/reservationStore.ts）

```typescript
interface ReservationState {
  reservations: Reservation[];
  addReservation: (playerIds: string[]) => void;
  removeReservation: (id: string) => void;
  fulfillReservation: (id: string) => void;
  clearReservations: () => void;
}
```

- localStorage永続化（key: `'badminton-reservations'`）

### Step 3: undoStore.tsの拡張

- `UndoEntry` に `reservations: Reservation[]` を追加
- undo/redo時にreservationStoreも復元

### Step 4: アルゴリズム修正（lib/algorithm.ts）

#### 4a. 予約メンバーの配置除外

`assignCourts()` の候補プレイヤーフィルタリングで：
- 未消化予約に含まれるプレイヤーを通常の配置候補から除外
- ただし予約が「全員待機中」の場合は予約配置として処理

#### 4b. 予約配置ロジック

`assignCourts()` の先頭で予約チェック：

```
1. 未消化予約をFIFO順に走査
2. 予約メンバー全員が待機中（!isResting && コートにいない）か確認
3. 全員揃っている予約があれば:
   - 1人: その人を最優先候補として通常ロジックで配置
   - 2人: その2人をペア固定 + 残り2人を通常ロジックで選出 → formTeams()をバイパスしてペア固定配置
   - 3人: 最初の2人をペア固定 + 3人目と通常ロジックで1人選出 → 対戦ペア形成
   - 4人: 最初の2人 vs 残り2人で固定配置
4. 配置完了したら予約を fulfilled に更新
```

#### 4c. sortWaitingPlayers() への反映

- 予約専用待機中のプレイヤーには「予約待ち」のマークを付与
- 待機一覧での表示順は変えないが、UIで予約状態を視覚的に区別

### Step 5: メイン画面UI（pages/MainPage.tsx）

- ヘッダーに予約ボタン追加
- 予約メンバーの待機リスト表示にバッジ/アイコン追加（「予約」ラベル）
- 予約一覧モーダル表示

### Step 6: 予約一覧モーダルコンポーネント（components/ReservationModal.tsx）

- 予約一覧表示
- 各予約の削除ボタン
- 消化済みの表示
- 「+」ボタンで追加モーダルへ

### Step 7: 予約追加モーダルコンポーネント（components/ReservationAddModal.tsx）

- アクティブメンバー一覧からチェックボックスで選択
- 1〜4人制限
- OK / キャンセルボタン

### Step 8: テスト

- 予約ストアの単体テスト
- アルゴリズムの予約統合テスト
  - 予約メンバーが候補から除外されること
  - 全員揃った時に優先配置されること
  - ペア固定が正しく動作すること
  - FIFO順が守られること
  - 重複予約の正しい処理

---

## ファイル変更一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/types/reservation.ts` | 新規: Reservation型定義 |
| `src/stores/reservationStore.ts` | 新規: 予約状態管理 |
| `src/stores/undoStore.ts` | 修正: UndoEntryにreservations追加 |
| `src/types/undo.ts` | 修正: UndoEntry型にreservations追加 |
| `src/lib/algorithm.ts` | 修正: 予約メンバー除外 + 予約配置ロジック |
| `src/pages/MainPage.tsx` | 修正: 予約ボタン + 予約バッジ表示 |
| `src/components/ReservationModal.tsx` | 新規: 予約一覧モーダル |
| `src/components/ReservationAddModal.tsx` | 新規: 予約追加モーダル |

---

## 注意事項

- 予約機能はアルゴリズムの根幹（`assignCourts`）に影響するため、既存テストが壊れないよう注意
- iOS Safari対応（タップターゲット44px以上、input 16px以上）
- モーダルはDESIGN.mdのスタイルガイドに準拠（rounded-2xl, shadow-xl等）
