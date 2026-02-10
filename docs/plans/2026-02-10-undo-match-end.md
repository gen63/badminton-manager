# 試合終了の取り消し機能（Undo Match End）

**日付**: 2026-02-10
**ステータス**: 計画中

---

## 背景・課題

連続設定モードで「終了」ボタンを誤タップすると、以下が即座に実行される：

1. `matchHistory` に試合レコード追加
2. 4人の `gamesPlayed` が +1、`lastPlayedAt` 更新
3. 休憩選手の `isResting` 復元
4. コートリセット
5. （連続モード時）新しい4人が自動配置＋自動開始

取り消す手段がなく、手動でのリカバリーが困難。

## 採用アプローチ: 取り消しトースト（B案）

「終了」実行後に一定時間「元に戻す」ボタン付きトーストを表示。
タップで直前の試合終了を巻き戻す。

### 不採用案

| 案 | 理由 |
|---|---|
| A: 確認ダイアログ | 毎回の操作に摩擦。連続モードの思想と矛盾 |
| C: フルUndo履歴 | 改修規模が大きすぎる。現状の課題に対してオーバー |

---

## 設計

### 1. 巻き戻し用スナップショット（gameStore に追加）

```typescript
interface UndoSnapshot {
  // 終了した試合の情報
  match: Match;
  courtId: number;
  // 終了前のコート状態（復元用）
  previousCourt: Court;
  // 終了前の各プレイヤー状態（復元用）
  previousPlayers: Array<{
    id: string;
    gamesPlayed: number;
    lastPlayedAt: number | null;
    isResting: boolean;
  }>;
  // 連続モードで自動配置された場合の情報
  autoAssigned?: {
    courtId: number;
    newCourt: Court;  // 自動配置後のコート状態
    // 自動開始されたので、これもリセットが必要
  };
}
```

gameStore に追加するステート・アクション：

```typescript
interface GameState {
  // 既存...

  // 追加
  undoSnapshot: UndoSnapshot | null;

  // 追加アクション
  setUndoSnapshot: (snapshot: UndoSnapshot | null) => void;
  clearUndoSnapshot: () => void;
}
```

### 2. handleFinishGame の修正（MainPage.tsx）

試合終了処理の **前に** スナップショットを取得・保存：

```
1. スナップショット取得（現在のコート状態、4人のプレイヤー状態）
2. 既存の試合終了処理を実行
3. 連続モード自動配置を実行（実行された場合、スナップショットに追記）
4. undoSnapshot をストアに保存
5. トースト表示（「元に戻す」ボタン付き、5秒間）
```

### 3. undoMatchEnd アクション

「元に戻す」ボタンタップ時の処理：

```
1. undoSnapshot を読み取り
2. matchHistory から該当 match を削除
3. 4人のプレイヤー状態を復元（gamesPlayed, lastPlayedAt, isResting）
4. コート状態を復元（previousCourt）
5. 自動配置が行われていた場合：
   a. 自動配置されたコートをリセット（teams, isPlaying を戻す）
   b. 自動配置で選ばれた新しい4人のプレイヤー状態も復元
      （gamesPlayed は変わっていないが、コートに配置された状態を解除）
6. undoSnapshot をクリア
7. トースト「試合終了を取り消しました」
```

### 4. トーストUI の拡張

既存の `Toast.tsx` / `useToast.ts` を拡張：

- `action` プロパティ追加: `{ label: string; onClick: () => void }`
- 表示時間: 5秒（通常トーストより長め）
- アクションボタンタップ時はトースト即閉じ

```
┌──────────────────────────────────────┐
│  試合を終了しました    [元に戻す]     │
└──────────────────────────────────────┘
```

### 5. エッジケース

| ケース | 対応 |
|---|---|
| トースト表示中に別コートの試合終了 | 前のスナップショットを破棄し新しいものに置き換え。1回分のみ保持 |
| トースト表示中にアプリリロード | スナップショットは persist しない。リロードで消失（許容） |
| 元に戻した後、再度「終了」 | 通常通り終了処理。新しいスナップショットが作られる |
| 連続モード OFF で誤操作 | 同様にトースト表示。自動配置部分がないだけ |
| スコア入力後の終了 | スコアも含めてスナップショットに保存。復元時にスコアも戻る |

---

## 実装ステップ

### Step 1: Toast の拡張
- `useToast` にアクションボタン対応を追加
- `Toast.tsx` にボタンUIを追加

### Step 2: UndoSnapshot 型定義と gameStore 拡張
- 型定義を `types/` に追加
- `gameStore` に `undoSnapshot` と関連アクションを追加
- persist 対象外にする（`partialize` で除外）

### Step 3: スナップショット取得ロジック
- `handleFinishGame` の冒頭でスナップショットを作成
- 連続モード自動配置後に `autoAssigned` を追記

### Step 4: undoMatchEnd の実装
- ストア状態の巻き戻しロジック
- プレイヤー状態の復元
- コート状態の復元

### Step 5: UI統合
- 試合終了時にアクション付きトーストを表示
- 「元に戻す」ボタンから `undoMatchEnd` を呼び出し

---

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/types/court.ts` または新規 `types/undo.ts` | UndoSnapshot 型定義 |
| `src/stores/gameStore.ts` | undoSnapshot ステート・アクション追加 |
| `src/hooks/useToast.ts` | アクションボタン対応 |
| `src/components/Toast.tsx` | ボタンUI追加 |
| `src/pages/MainPage.tsx` | スナップショット取得・トースト表示・undo呼び出し |

新規ファイルの追加は最小限（型定義のみ、場合により既存ファイルに追記）。
