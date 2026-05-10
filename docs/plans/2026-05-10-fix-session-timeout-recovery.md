# 2026-05-10 セッションタイムアウト後の真っ白画面復帰

## 背景・現象

ブラウザ版で以下の流れで画面が真っ白になり復帰できないことがある:

1. ユーザーが本アプリのタブを開いた状態にする
2. 別タブ・別アプリで作業し、タブを長時間バックグラウンドにする
   （あるいは PC/スマホがスリープに入る）
3. タブに戻ると画面が真っ白で、ユーザー操作で復帰できない
   （リロードでしか戻らない）

## 原因分析

`Explore` 調査の結果、複数の要因が重なって真っ白に見える状態を作っていることが分かった:

### 原因 A: `onSnapshot` 切断後の再接続契機が無い

`src/hooks/useFirebaseSync.ts:69-221` の `onSnapshot` は `sessionId` 変更でのみ
unsub/resub する。長時間バックグラウンド後やネット復帰直後に Firestore の
WebSocket が切れたままになると:

- error コールバックで `syncError` だけ立つ → `SyncErrorBanner` 上のリロード
  ボタンを押さない限り再購読が走らない
- error が来ない silent stall ケース (browser が socket を suspend 等) では
  `syncError` すら立たず、ストアは空のまま

`document.visibilitychange` を購読していないため「タブに戻った」を契機に
再接続する手段が現状ない。

### 原因 B: render 中の `navigate('/')` で真っ白

`MainPage.tsx:229-231`、`HistoryPage.tsx:247-250`、`SettingsPage.tsx:48-51`、
`ReservationPage.tsx:25-28`、`AccountingPage.tsx:313-316` で:

```tsx
if (!session) {
  navigate('/');
  return null;
}
```

これは React の render-side-effect アンチパターン。実際以下の問題がある:

- `navigate` は副作用（render 中に呼ぶと StrictMode で 2 回走る／警告を出す
  バージョンがある）
- ナビゲーションが完了する前のフレームは `null` を返すため、Suspense fallback
  も出ず文字通り真っ白
- ストアが復元中（onSnapshot 初回受信前）でも一瞬 session が null になり、
  瞬間的に `/` に飛ばされ、ユーザーから見ると「戻れない」状態に見える

### 原因 C: `SyncErrorBanner` がリロード以外の復旧手段を提供しない

`SyncErrorBanner.tsx:10-27` は `syncError` を表示するだけで、自動再接続も
手動の「再接続」ボタンも無く、リロードしかない。リロード中は当然真っ白に
見える。

## 設計

最小コードで以下 3 点を改善する。`docs/plans/2026-05-03-firestore-as-source-of-truth.md`
の Phase 3 設計（Firestore 単一の真実、ストアは onSnapshot で受信）と矛盾しない範囲。

### 改善 1: `useFirebaseSync` に visibility & online リスナーを追加

タブが visible に戻った／ネットが online に戻った瞬間に「現在の購読が生きて
いるか」を確認し、必要なら unsubscribe & 再 subscribe する。

実装方針:

- `syncStatusStore.reconnectNonce` を increment すると `useFirebaseSync` の
  `useEffect` が再実行 (unsub → 新 subscribe) する仕組み
- `visibilitychange` (visible) と `online` イベントで `requestReconnect()` を呼ぶ
- 過剰な再接続を抑える 2 段ガード:
  - **Throttle**: 直近の resubscribe から 5 秒以内なら no-op
  - **Hidden duration**: 短時間 (< 60 秒) の alt-tab では再接続しない。
    ただし既に `syncError` が立っている場合は短時間でも再接続する
- 副次効果: 再 subscribe 時に Firestore SDK は最新 doc を再送信するため
  `gameStateLoaded` も自動で再 true 化する
- `online` イベントは頻繁に発火しないので duration ガードは不要、5 秒 throttle のみ

### 改善 2: render 中 `navigate` を排除し、`<Navigate>` 要素 / `useEffect` に置換

該当 5 箇所を以下に置換:

```tsx
if (!session) {
  return <Navigate to="/" replace />;
}
```

- `<Navigate>` は render-time に副作用を起こさない React Router の正規 API
- 一瞬でも `null` を返さないため真っ白フレームが発生しない
- そもそも Firestore からの初回受信を待ちたい場合は別途 ローディング UI を
  出すべきだが、本 plan では「真っ白のまま操作不能」回避を最小修正で達成する
  ことを優先する。`AccountingPage.tsx:313` だけは `currentUser` が無い場合の
  既存ローディング UI と並ぶので、`<Navigate>` で統一する

### 改善 3: `SyncErrorBanner` に「再接続」ボタンを追加

リロードに加え、ページを reload せず onSnapshot 再購読だけ走らせる
「再接続」ボタンを置く。`useFirebaseSync` 側で resubscribe を外部から
キックできるよう `useSyncStatusStore` に `reconnectNonce: number` を追加し、
ボタンが increment、`useFirebaseSync` の `useEffect` 依存に含める。

```ts
// syncStatusStore.ts
reconnectNonce: 0,
requestReconnect: () => set((s) => ({ reconnectNonce: s.reconnectNonce + 1 })),
```

UX:
- 「再接続」ボタン: 即座に再購読、押下中は spinner
- 「リロード」ボタン: 既存通り（最終手段）

## 触らない範囲

- `ErrorBoundary` は React 同期エラー専用で、本件は async 系なので変更不要
- `partialize` で session を localStorage に戻すのは `Phase B` の方針に反するため不採用
- Firestore SDK の `enableNetwork()`/`disableNetwork()` 操作は副作用が大きい
  ため使わない（`onSnapshot` 再購読で十分回復する）
- 5 箇所の page guard を共通 hook 化する誘惑があるが、本 plan は修正最小に
  留め、各 page の `if (!session)` を `<Navigate>` に置換するだけにする

## 検証

- `npm run build && npm run lint && npm run test:run`
- 手動確認:
  1. アプリを開いてセッションに参加
  2. 別タブに移動して 5 分以上放置
  3. 戻ってきて画面が表示されること、`onSnapshot` が再受信していること
     (DevTools Network で確認)
  4. ネットを一旦オフにしてオンに戻す → 自動再接続バナー消滅
  5. 強制的に長時間放置で `syncError` が出た場合、「再接続」ボタンで
     リロード無しに復帰すること

## 影響ファイル

- `src/hooks/useFirebaseSync.ts` (visibility/online + reconnectNonce 対応)
- `src/stores/syncStatusStore.ts` (reconnectNonce 追加)
- `src/components/SyncErrorBanner.tsx` (再接続ボタン追加)
- `src/pages/MainPage.tsx` / `HistoryPage.tsx` / `SettingsPage.tsx` /
  `ReservationPage.tsx` / `AccountingPage.tsx` (`navigate` → `<Navigate>`)
