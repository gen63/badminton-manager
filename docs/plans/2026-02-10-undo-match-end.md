# 試合終了の取り消し機能（Undo Match End）

**日付**: 2026-02-10
**ステータス**: 確定

---

## 背景・課題

連続設定モードで「終了」ボタンを誤タップすると、以下が即座に実行される：

1. `matchHistory` に試合レコード追加
2. 4人の `gamesPlayed` が +1、`lastPlayedAt` 更新
3. 休憩選手の `isResting` 復元
4. コートリセット
5. （連続モード時）新しい4人が自動配置＋自動開始

取り消す手段がなく、手動でのリカバリーが困難。

## 採用アプローチ: フルUndo/Redo（C案）

フルスナップショット方式で最大50回のUndo/Redoを提供。

### 検討した他の案

| 案 | 理由 |
|---|---|
| A: 確認ダイアログ | 毎回の操作に摩擦。連続モードの思想と矛盾 |
| B: 取り消しトースト（1回のみ） | 機能として弱い。複数回の誤操作に対応できない |

---

## 確定仕様

| 項目 | 仕様 |
|---|---|
| 対象操作 | 試合終了のみ |
| Undo回数 | 最大50回 |
| Redo | あり（Undo後に新しい試合終了でRedo履歴クリア） |
| 永続化 | localStorage（Zustand persist） |
| UI | ヘッダーにUndo/Redoボタン |
| スナップショット方式 | フルスナップショット（courts + players + matchHistory を丸ごと保存） |

---

## 設計

### 1. スナップショット方式

試合終了の**前に**、関連する全ストアの状態を丸ごと保存する。
**必ず `structuredClone()` でディープコピーすること。** 参照を保存すると後続のストア変更でスナップショットが壊れる。

```typescript
interface UndoEntry {
  courts: Court[];
  players: Player[];
  matchHistory: Match[];
  timestamp: number;  // スナップショット取得時刻
}

// スナップショット取得例
const snapshot: UndoEntry = {
  courts: structuredClone(useGameStore.getState().courts),
  players: structuredClone(usePlayerStore.getState().players),
  matchHistory: structuredClone(useGameStore.getState().matchHistory),
  timestamp: Date.now(),
};
```

メモリ見積もり（選手20人・試合50件・コート3面）：
- players: ~2KB
- courts: ~0.6KB
- matchHistory: ~7.5KB
- 1エントリ: ~10KB × 50 = ~500KB（localStorage的に問題なし）

### 2. undoStore（新規ストア）

gameStore / playerStore とは独立した専用ストアを新設。

```typescript
interface UndoState {
  undoStack: UndoEntry[];  // 最大50
  redoStack: UndoEntry[];  // 最大50

  // アクション
  pushUndo: (entry: UndoEntry) => void;  // undoStack に追加、redoStack クリア
  undo: () => void;                       // undoStack から pop → gameStore/playerStore を復元 → redoStack に push
  redo: () => void;                       // redoStack から pop → gameStore/playerStore を復元 → undoStack に push
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearAll: () => void;
  // ※ undo() / redo() 内で useGameStore.setState() / usePlayerStore.setState() を呼ぶ（クロスストア依存）
}
```

persist設定：
- `name: 'undo-storage'`
- localStorage に保存（通常のストアと同じ）

### 3. Undo/Redo フロー

```
【試合終了時】
1. 現在の状態をスナップショット: { courts, players, matchHistory }
2. undoStack.push(snapshot)  ※50件超えたら oldest を drop
3. redoStack = []  ※新しい操作でRedo履歴クリア
4. 既存の試合終了処理を実行
5. （連続モード時）自動配置＋自動開始

【Undo時】
1. 現在の状態をスナップショット
2. redoStack.push(現在の状態)
3. undoStack.pop() → 復元対象
4. gameStore.setState({ courts, matchHistory })
5. playerStore.setState({ players })
6. トースト「試合終了を取り消しました」

【Redo時】
1. 現在の状態をスナップショット
2. undoStack.push(現在の状態)
3. redoStack.pop() → 復元対象
4. gameStore.setState({ courts, matchHistory })
5. playerStore.setState({ players })
6. トースト「試合終了をやり直しました」
```

### 4. ヘッダーUI

MainPage ヘッダーに Undo/Redo ボタンを配置：

```
┌─────────────────────────────────────────┐
│  ↩  ↪  │  バドミントン管理  │  連続 ⚙  │
│ undo redo                               │
└─────────────────────────────────────────┘
```

- `↩` Undoボタン: `undoStack.length > 0` で活性化、それ以外はグレーアウト
- `↪` Redoボタン: `redoStack.length > 0` で活性化、それ以外はグレーアウト
- アイコン: lucide-react の `Undo2` / `Redo2`
- タップターゲット: 44px以上（DESIGN.md準拠）

### 5. エッジケース

| ケース | 対応 |
|---|---|
| Undo後に試合終了 | 通常通りスナップショット取得。redoStack クリア |
| 51回目の試合終了 | undoStack の oldest を drop して push（FIFO） |
| 連続モードで自動配置された試合のUndo | フルスナップショットなので自動配置前の状態に丸ごと戻る |
| 複数コート同時終了 | 各終了が順番にスナップショットを push |
| アプリリロード | localStorage から復元。Undo/Redo 可能 |
| セッションクリア時 | undoStack/redoStack も clearAll() |
| Undo中に別の操作（休憩切替等） | Undo対象は試合終了のみなので、他の操作はundo/redoに影響しない ※注意点あり（後述） |

### 6. 注意点: フルスナップショットの制約

フルスナップショットはUndo時に **全ストア状態** をスナップショット時点に復元する。
そのため、試合終了後〜Undo実行までの間に行われた**他の操作も巻き戻される**。

具体的に巻き戻される操作の例：
- プレイヤーの休憩状態の手動切替
- **プレイヤーの新規追加**（追加したプレイヤーが消える）
- **プレイヤーの削除**（削除したプレイヤーが復活する）
- コートへの手動配置

→ これは許容する。Undoは「その時点の状態に完全に戻す」という明確なセマンティクス。
→ UIでUndo時にトーストで通知すれば、ユーザーは何が起きたか理解できる。

### 7. 注意点: 連続モードで進行中の試合に対するUndo

連続モードでは試合終了後に自動で次の試合が開始される。
Undoすると**自動開始された試合も消えて、元の試合が進行中の状態に戻る**。

```
例:
  コート1: 試合A進行中 → 終了 → 試合B自動開始（進行中）
  Undo → コート1: 試合A進行中に戻る（試合Bは消える）
```

試合Bがしばらく進行してからUndoされると混乱する可能性があるが、
これはフルスナップショット方式の意図通りの動作。
ユーザーが意識的にUndoボタンを押す操作なので許容する。

---

## 実装ステップ

### Step 1: UndoEntry 型定義
- `src/types/undo.ts` に `UndoEntry` インターフェースを定義

### Step 2: undoStore 作成
- `src/stores/undoStore.ts` を新規作成
- `undoStack` / `redoStack` / アクション実装
- Zustand persist 設定

### Step 3: handleFinishGame にスナップショット取得を追加
- `MainPage.tsx` の試合終了処理の冒頭でスナップショット取得
- `undoStore.pushUndo()` 呼び出し

### Step 4: Undo/Redo ロジック実装
- `undoStore.undo()`: gameStore / playerStore の状態を復元
- `undoStore.redo()`: 同上

### Step 5: ヘッダーUI
- MainPage ヘッダーに Undo/Redo ボタン追加
- 活性/非活性の制御
- トースト通知

### Step 6: ビルド確認
- `npm run build` で型エラー・ビルドエラーがないことを確認

---

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/types/undo.ts`（新規） | UndoEntry 型定義 |
| `src/stores/undoStore.ts`（新規） | Undo/Redo ストア |
| `src/pages/MainPage.tsx` | スナップショット取得、ヘッダーUI、Undo/Redo呼び出し |

既存ファイルの変更は `MainPage.tsx` のみ。
新規ファイル2つはいずれも小規模。
