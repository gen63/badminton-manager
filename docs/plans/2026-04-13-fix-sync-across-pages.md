# 会費入力・名簿入力の同期が他デバイスに反映されない問題の修正

## Context

共有セッションで、PlayerSelect ページ (`/players`) 上の「支払」「名簿」ボタン操作が他デバイスに同期されない。
AccountingPage (`/accounting`) での変更も同様。

## 根本原因

`useFirebaseSync` フックは **`MainPage.tsx` (`/main`) でのみマウント**されている。
BottomNav でタブ切替すると React Router がページコンポーネントを unmount/mount するため、
`/players` や `/accounting` に遷移した時点で Firebase 双方向同期が完全に停止する。

### 具体的な影響

1. **Push 停止**: `/players` で `toggleOperationStatus(id, 'roster')` を実行 → `playerStore` は更新されるが、`useFirebaseSync` の store subscription が存在しないため Firebase に push されない
2. **Pull 停止**: `onSnapshot` リスナーも解除されるため、他デバイスの変更を受信できない
3. **非作成者のデータ喪失**: `/main` に戻ると `useFirebaseSync` が再マウントされ、`onSnapshot` が発火 → リモートデータでローカル変更が上書きされる（非作成者は初回 push がないため）

### 影響範囲の確認

```
src/pages/MainPage.tsx:34  ← useFirebaseSync() の唯一の呼び出し箇所
src/App.tsx:22             ← /players は別 Route（MainPage と同時マウントされない）
src/App.tsx:25             ← /accounting も同様
```

### 同じ問題が発生する全ページ

| ページ | パス | 影響を受けるストア |
|--------|------|-------------------|
| PlayerSelect | `/players` | `playerStore`（支払/名簿フラグ） |
| AccountingPage | `/accounting` | `playerStore`（支払データ参照） |
| ReservationPage | `/reservation` | `reservationStore`（予約の追加/削除） |
| SettingsPage | `/settings` | `settingsStore`（スコア記録、練習種別等） |
| ScoreInputPage | `/score/:matchId` | `gameStore`（スコア編集） |
| HistoryPage | `/history` | `gameStore`（試合履歴の削除） |

### accountingStore について

`accountingStore`（会計フォームの人数・金額等）は設計上 localStorage のみ。
各デバイスで異なる入力があり得るため、Firebase 同期対象外とする（変更不要）。
同期が必要なのは `playerStore` 内の `operationStatus`（支払/名簿フラグ）と `paymentAmount`。

## 修正計画

### Step 1: `FirebaseSyncContext` の作成

**新規ファイル**: `src/contexts/FirebaseSyncContext.tsx`

- `useFirebaseSync()` の戻り値 (`prepareDirectTransaction`, `completeDirectTransaction`) を Context で公開
- Provider コンポーネントを作成し、内部で `useFirebaseSync()` を1回だけ呼ぶ
- Consumer 用の `useFirebaseSyncContext()` フックをエクスポート

```typescript
// 概要
const FirebaseSyncContext = createContext<{
  prepareDirectTransaction: () => void;
  completeDirectTransaction: (writtenState?: GameState) => void;
} | null>(null);

export function FirebaseSyncProvider({ children }) {
  const syncApi = useFirebaseSync();
  return (
    <FirebaseSyncContext.Provider value={syncApi}>
      {children}
    </FirebaseSyncContext.Provider>
  );
}

export function useFirebaseSyncContext() {
  const ctx = useContext(FirebaseSyncContext);
  if (!ctx) throw new Error('FirebaseSyncProvider is required');
  return ctx;
}
```

### Step 2: `App.tsx` に Provider を追加

**変更ファイル**: `src/App.tsx`

- `<BrowserRouter>` の内側、`<Routes>` の外側に `<FirebaseSyncProvider>` を配置
- `useFirebaseSync` は `useNavigate()` を使うため、`BrowserRouter` の内側に置く必要がある

```tsx
<BrowserRouter basename="/badminton-manager">
  <FirebaseSyncProvider>
    <Routes>
      ...
    </Routes>
    <PWAPrompt />
  </FirebaseSyncProvider>
</BrowserRouter>
```

### Step 3: `MainPage.tsx` の修正

**変更ファイル**: `src/pages/MainPage.tsx`

- `useFirebaseSync()` の直接呼び出しを `useFirebaseSyncContext()` に置き換え
- import を変更

```diff
- import { useFirebaseSync } from '../hooks/useFirebaseSync';
+ import { useFirebaseSyncContext } from '../contexts/FirebaseSyncContext';

- const { prepareDirectTransaction, completeDirectTransaction } = useFirebaseSync();
+ const { prepareDirectTransaction, completeDirectTransaction } = useFirebaseSyncContext();
```

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/contexts/FirebaseSyncContext.tsx` | **新規** Context + Provider + hook |
| `src/App.tsx` | Provider でラップ |
| `src/pages/MainPage.tsx` | Context hook に切替 |

## 変更しないファイル

- `src/hooks/useFirebaseSync.ts` — API変更なし
- `src/lib/syncUtils.ts` — 変更なし
- `src/services/sessionService.ts` — 変更なし
- `src/stores/playerStore.ts` — 変更なし
- `src/stores/accountingStore.ts` — 設計上 local-only のまま

## エッジケースの確認

1. **セッション未作成時**: `useFirebaseSync` の useEffect は `if (!isShared || !sessionId) return;` で早期リターンするため、セッション作成前（`/`、`/session/create`）では何もしない → 問題なし
2. **`useNavigate` の位置**: Provider は `<BrowserRouter>` 内に配置するため、`useNavigate()` は正常に動作
3. **Context の再レンダリング**: `prepareDirectTransaction` と `completeDirectTransaction` は `useCallback([], [])` で安定参照 → 不要な再レンダリングは発生しない
4. **`lastSyncedState` の永続化**: Provider が常時マウントされるため、ref が常にメモリに残る。sessionStorage フォールバックは PWA 復帰・ページリロード時のみ必要になる（改善）

## 検証手順

1. `npm run build` — 型チェック + ビルド
2. `npm run lint` — コードスタイル
3. `npm run test:run` — 既存ユニットテスト
4. 手動テスト:
   - ブラウザ2タブで共有セッション開始
   - Tab A: `/players` に移動 → 名簿ボタンをタップ
   - Tab B: `/players` で名簿の緑チェックが反映されることを確認
   - Tab A: 支払ボタンで金額入力
   - Tab B: 支払の緑チェック + 金額が反映されることを確認
