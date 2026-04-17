# 隠し機能：dev URL経由でのセッション削除

## Context

既存の「全リセット」ボタン（`SettingsPage.tsx:500`）は管理者のみ利用可能で、
Firestoreのセッションドキュメントを削除しローカル状態もクリアする。
この削除機能を**開発者/メンテナンス用に管理者権限なしでも使える**ように
隠しエントリーポイントを追加する。

**要件:**
- クエリパラメータ `?dev=1` 付きURLを一度開いたブラウザでのみ有効（永続）
- 設定画面に通常とは別の「セッション削除」ボタンを追加（B案：全リセットと共存）
- dev modeが有効なら**管理者でなくても**表示・操作可能
- localStorageに永続化（ブラウザを閉じても有効）

**非要件:**
- dev modeのOFF切り替えUIは本プランでは作らない（`?dev=0` で無効化のみ対応）

## 設計方針

**URL検知はApp.tsxで副作用として処理。React hookで値を参照する形にする。**
- `?dev=1` → `localStorage.setItem('dev-mode', '1')`
- `?dev=0` → `localStorage.removeItem('dev-mode')`
- その他は変更なし（URLから消えてもlocalStorageに残る）

**既存の「全リセット」とは独立して表示する。**
- 全リセット: 管理者のみ（既存のまま、変更なし）
- セッション削除: dev mode有効時のみ（管理者不問）
- ラベル・配色を明確に分けて誤操作を防ぐ

## 変更ファイル一覧

### 1. `src/hooks/useDevMode.ts` (新規)

```ts
import { useSyncExternalStore } from 'react';

const KEY = 'dev-mode';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
}

function getSnapshot(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function useDevMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function applyDevModeFromUrl(search: string): void {
  const params = new URLSearchParams(search);
  const dev = params.get('dev');
  if (dev === '1') localStorage.setItem(KEY, '1');
  else if (dev === '0') localStorage.removeItem(KEY);
}
```

補足:
- `useSyncExternalStore` で他タブからの変更にも反応（不要なら簡易な `useState` + 初回読み取りでも可）
- 書き込み直後にstorageイベントは発火しないため、URL検知直後に再レンダーは別途必要（下記参照）

### 2. `src/App.tsx` — URL検知を追加

`App` 関数の最初で `useEffect` 相当を追加（BrowserRouterの外で `window.location.search` を見る）:

```tsx
import { useEffect } from 'react';
import { applyDevModeFromUrl } from './hooks/useDevMode';

function App() {
  useEffect(() => {
    applyDevModeFromUrl(window.location.search);
  }, []);
  // ...既存コード
}
```

ポイント:
- ルーティング前に1回だけ実行
- `?dev=1` で開いた時点で永続化、以降そのブラウザで有効
- localStorage書き込み後に `useDevMode` を使うコンポーネントに即反映させるため、
  書き込み後に `window.dispatchEvent(new StorageEvent('storage'))` を発火させるか、
  簡略化のためApp初回レンダー後の設定画面遷移では自然に反映されることを前提にする。

### 3. `src/pages/SettingsPage.tsx` — 新ボタン追加

**追加箇所**: 既存の `{userIsAdmin && (...)}` 管理者用カード（line 482-508）の**外側下**に、
dev mode用カードを追加。

```tsx
{devMode && (
  <div className="card p-4 border-2 border-dashed border-gray-400">
    <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
      <span className="w-6 h-6 rounded-lg bg-gray-200 flex items-center justify-center">
        <Trash2 size={14} className="text-gray-700" />
      </span>
      セッション削除
      <span className="text-[10px] bg-gray-700 text-white px-1.5 py-0.5 rounded-full">DEV</span>
    </h2>
    <button
      onClick={handleDevDelete}
      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 border-2 border-gray-400 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
    >
      <Trash2 size={16} />
      セッションを削除
    </button>
  </div>
)}
```

**ハンドラ** (`handleFullReset` を参考に簡略化):

```tsx
const handleDevDelete = async () => {
  const confirmed = window.confirm(
    '[DEV] このセッションを削除しますか？\n\n' +
    'Firestoreドキュメントとローカル状態をすべて削除します。\n' +
    'この操作は取り消せません。'
  );
  if (!confirmed) return;

  if (session.id && session.createdBy) {
    try {
      await deleteSession(session.id);
    } catch (error) {
      console.error('Failed to delete session from Firestore:', error);
    }
  }
  clearHistory();
  clearPlayers();
  clearUndo();
  clearRecords();
  clearReservations();
  clearSession();
  await clearAppBadge();
  navigate('/');
};
```

import追加: `import { useDevMode } from '../hooks/useDevMode';`
関数内: `const devMode = useDevMode();`

**配色・ラベル**:
- 全リセット = 赤（既存、管理者用）
- セッション削除 = グレー + 点線枠 + [DEV] バッジ（dev用であることを視覚的に示す）

### 4. テスト（任意）

`src/hooks/useDevMode.test.ts` を追加して `applyDevModeFromUrl` の動作を確認:
- `?dev=1` → localStorageに`1`が保存される
- `?dev=0` → localStorageから削除される
- `?foo=bar` → 変化なし

## 検証方法

1. `npm run build` — 型チェック通過
2. `npm run lint` — lintエラーなし
3. `npm run test:run` — テスト通過
4. 手動確認:
   - 通常URLで設定画面 → 「セッション削除」ボタンが**表示されない**
   - `https://.../#/foo?dev=1` で開く → localStorage に `dev-mode=1`
   - 設定画面に「セッション削除」ボタンが表示される（管理者でなくても）
   - クリック → 確認 → Firestoreドキュメント削除 → ホームに遷移
   - 別タブで通常URLを開いても設定画面にボタンが表示されたまま（永続）
   - `?dev=0` で開くと以降表示されなくなる

## 注意点

- **セキュリティ**: クライアント側のフラグなので、本当の権限分離ではない。
  Firestoreルール上、`deleteSession()` が実行できる条件はこれまでと同じ
  （既存の全リセットと同じ呼び出し）。UIを隠すのは"誤操作防止"であり、
  認可ではない。
- **全リセットとの役割分担**: UI的に2つの削除ボタンが存在するが、配色・ラベル・
  権限条件で区別。同時に表示される場合もある（管理者 かつ dev mode有効時）。
- **basename考慮**: `BrowserRouter basename="/badminton-manager"` のため、
  実URLは `/badminton-manager/?dev=1` となる。`window.location.search` は
  basenameの影響を受けないので問題なし。
