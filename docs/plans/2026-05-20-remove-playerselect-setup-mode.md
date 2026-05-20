# PlayerSelect Setup Mode 廃止 + セッション切断時の即時遷移

日付: 2026-05-20
ブランチ: `claude/review-screen-navigation-y7aBd`

## 背景

`src/pages/PlayerSelect.tsx` には 2 つの分岐がある：

- **Tab Mode** (247-304行): `session` が set されているとき。参加者一覧の表示・編集のみ。
- **Setup Mode** (307-388行): `session` が null のとき。「参加者を追加」ヘッダー、textarea + 追加ボタン、完了ボタンを描画。

Setup Mode は Phase 4 (Firebase 必須化) 以前のローカルセッション作成フローの遺物で、
現在は正規導線から到達不可：

- `/players` への navigate は `BottomNav.tsx:70,85` の 1 箇所のみ。
- BottomNav は session 有りのページでしか描画されないため、`/players` 到達時は常に `isTabMode=true`。
- `SessionCreate` は `/players` を経由せず、参加者名入力 → `createSession` → 直接 `/main` へ。
- 参加者追加 UI はオンラインモードでは `MainPage.tsx:1039-1059` の「メンバー追加」展開ボタンで提供済み。

ただし `useFirebaseSync` 内のセッション削除/TTL ハンドラが `clearSession()` 後に
`setTimeout(..., 1000-2000ms)` で `/` へ navigate するため、`/players` 滞在中に
発火すると一瞬 Setup Mode が描画される（フラッシュ）。これが本来意図しない
画面の表面化に繋がっている。

加えて、useFirebaseSync が呼ぶ `toast.error/warning` は **そもそも表示されていない**：

- `useToast` は per-component の useState バッグで、グローバル ToastProvider 無し。
- `<Toast />` を描画しているのは各ページコンポーネント側で、`useFirebaseSync` 内の
  toast インスタンスを参照するレンダラーが存在しない。
- 結果として、セッション削除/TTL 切れ時に通知が出ず、ユーザーは理由不明で
  SessionSelectPage に戻される。

## ゴール

1. PlayerSelect の Setup Mode を削除し、`/players` を session 必須化する
2. `useFirebaseSync` のセッション切断/TTL ハンドラを即時 navigate に変更し、
   フラッシュを根絶する
3. 切断理由を SessionSelectPage 側で確実にユーザーに表示する

## 変更内容

### 1. `src/pages/PlayerSelect.tsx`

- Setup Mode ブロック (307-388行) を削除
- 冒頭に session ガード `if (!session) return <Navigate to="/" replace />;` を追加
  （`MainPage` / `HistoryPage` / `ReservationPage` 等と同じパターン）
- `isTabMode` 定数を撤去、`if (isTabMode) { ... }` 分岐を解消し Tab Mode の
  本体だけ残す
- `canEdit` / `canDelete` の `!isTabMode ||` フォールバックを削除：
  - `canEdit`: `isAdmin || player.name === currentUser`
  - `canDelete`: `isAdmin`
- 不要 import / state / handler を撤去：
  - `useNavigate` import および `navigate` 変数
  - `UserPlus`, `ArrowRight` (lucide-react)
  - `parsePlayerInput` (lib/utils)
  - `newPlayerNames` state
  - `handleAddPlayers`, `handleContinue` 関数

### 2. `src/hooks/useFirebaseSync.ts`

- セッション削除ハンドラ (126-134行) の `setTimeout` を撤去、即時 navigate
- TTL 切れハンドラ (160-176行) の `setTimeout` を撤去、即時 navigate
- 内部の `toast.error/warning` 呼び出し（実質 no-op）を撤去
- 遷移先で表示できるよう `navigate('/', { state: { notice: {...} } })` の
  形で notice を渡す：
  ```ts
  navigateRef.current('/', {
    state: { notice: { type: 'error', message: 'セッションが削除されました' } },
  });
  ```
- `toast` / `toastRef` 周りの本フック内での使用は削除可能（他で使っていなければ）。
  使い続けるなら維持。

### 3. `src/pages/SessionSelectPage.tsx`

- `useLocation` を追加し、マウント時 `location.state?.notice` を読み取る
- 取得した notice を既存の `error` state にセット → 既存エラーバナー
  (207-209行) で表示
- 再表示防止のため `window.history.replaceState({}, '', location.pathname)` などで
  state をクリア（react-router の `navigate(pathname, { replace: true, state: null })`
  でも可）

## 信頼モデル / セキュリティへの影響

なし。本変更は UI ガード追加と遷移タイミング修正のみ。Firestore Security Rules
や認証モデルは変更しない。

## 検証

### コマンド

```bash
npm run build
npm run lint
npm run test:run
```

### 手動

1. `/players` 滞在中に Firebase コンソールでセッション削除 → 即時 `/` に遷移、
   SessionSelectPage 上に「セッションが削除されました」のバナーが表示される
2. 通常の BottomNav 「参加者」タブ操作で `/players` が問題なく開く
3. PlayerSelect 内の編集・削除・支払い・名簿 ToDo が従来通り動く
4. リロード後は SessionSelectPage に戻り、location.state が無い場合バナーは出ない

## 非ゴール

- `useToast` のグローバル化（影響範囲が広いため別 PR）
- BottomNav の遷移先変更
- `MainPage` のメンバー追加 UI の `/players` への移植
