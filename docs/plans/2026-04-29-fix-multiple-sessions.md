# セッション切替時のローカル再同期 + 旧セッション自動退出

## 背景

ユーザー報告: 「セッション一覧に二つのセッションを作ったとき、両方にログインしたことになる」

調査の結果、次の3つの問題が複合していた:

### A. ローカル sync 状態が App 寿命中ずっと持続
`FirebaseSyncProvider` (`src/App.tsx`) は key なしで App 直下に配置されており、`useFirebaseSync` 内の以下 ref がセッションをまたいで漏出していた:

- `lastSyncedState` — 3-way merge の base。前セッションの値が残ると新セッションの merge 結果が壊れる
- `lastPushedHash` / `lastPushedTime` / `lastAppliedRemoteUpdatedAt` — `shouldApplyRemoteData` の guard が誤って block する
- `sessionDeletedNotified` — 削除通知フラグが残り次セッションの正規通知を抑制し得る
- `notifiedMatches` (module-scoped Set) — 試合通知の重複抑止 Set がセッション間で蓄積

### B. 旧セッション `participants` に自分が残り続ける
`leaveSession` 相当の関数が存在せず、`SessionCreate.handleCreate` も `SessionJoinPage.handleJoin` も新規セッション参加前に旧セッションの participants を更新していなかった。`SessionSelectPage` は participants.length を「N名参加中」と表示するため、ユーザーから見ると「両方にログインしたまま」と映る。

### C. 旧セッションを意図せず空状態で上書きするレース
`SessionCreate.handleCreate` と `SessionJoinPage.handleJoin` で `clearPlayers/clearHistory/...` を呼ぶ時点では sessionStore.session はまだ旧セッション A のままで、App 直下の `useFirebaseSync` は A 用 listener をアクティブに保っているため:

1. clearPlayers などが Zustand subscriber を発火
2. `schedulePush(A)` (300ms debounce) がキュー
3. 続く `await joinSession/createSession` 中に 300ms 経過してタイマー発火
4. 空のローカル状態 + base=A-state で `syncGameStateWithTransaction` → A のデータを実質ワイプ

事象が起こり得る。直後に provider が remount しても手遅れ。

## 修正内容

| ファイル | 内容 |
|---------|------|
| `src/services/sessionService.ts` | `leaveSession(sessionId, playerName)` を追加。runTransaction で `participants` から自分を除去し、`createdBy` は温存する |
| `src/hooks/useFirebaseSync.ts` | useEffect cleanup で session-scoped 全 ref (`lastSyncedState` / `lastPushedHash` / `lastPushedTime` / `lastAppliedRemoteUpdatedAt` / `sessionDeletedNotified` / `blockedUpdate` / `isSyncingFromRemote`) と module-scoped `notifiedMatches` をリセット |
| `src/pages/SessionCreate.tsx` | `useFirebaseSyncContext` を import。`handleCreate` 冒頭と `handleLoadFromSheets` 自動開始ブランチで旧オンラインセッションがあれば `prepareDirectTransaction()` で push を抑止し、`leaveSession` + `clearPresence` を fire-and-forget |
| `src/pages/SessionJoinPage.tsx` | 同様に `handleJoin` 冒頭で別セッションに居れば離脱処理。同一セッションへの force 再入室は対象外 |

### 設計判断: `key={sessionId}` ではなく ref 手動リセット

当初は `<FirebaseSyncProvider key={sessionId}>` で remount する案を検討したが、`FirebaseSyncProvider` は `<Routes>` を内包しているため key 変更で **ページコンポーネント自体が unmount/remount** されてしまう。これにより `SessionCreate.handleCreate` の途中（`initializeSession(B)` で sessionId が変わった瞬間）に SessionCreate が unmount され、後続の `setCreatedSessionId` が効かず URL 表示画面が出ない、という UX 破壊が発生する。代わりに `useFirebaseSync` の cleanup で session-scoped ref を全部リセットすることで、ページツリーを保ったまま sync 内部状態だけをセッション境界で初期化する。

### 既存資産の再利用
- `useFirebaseSync.prepareDirectTransaction` — pushTimer キャンセル + `isSyncingFromRemote=true` を既に実装済み
- `clearPresence` — Firestore presence エントリを削除する既存関数
- `runTransaction` パターン (joinSession のスタイルを踏襲)

## 非ゴール

- 旧セッションの `createdBy` は変更しない（ownership と participation を分離）
- `settingsStore` のセッション横断保持は今回扱わない（recordScores 等は数百 ms 旧値が見えるが Firestore pull が即座に上書きする）
- 複数タブで違うセッションを並行運用するケースはユーザー方針により非サポート
- `SettingsPage.handleFullReset` の wipe-push レースは別タスク

## 検証

- `npm run build && npm run lint && npm run test:run` を全通し
- 手動 E2E (Firebase 構成済み):
  - 2 セッション連続作成→ 一覧で旧セッションが「0名参加中」になり、旧セッションのデータが消えていないこと
  - セッション切替後、旧セッションのローカル残骸が新セッションに混入しないこと
  - 同一セッションへの force 再入室は既存挙動を維持すること
- オフライン時に `void Promise.allSettled` で離脱失敗してもメイン経路をブロックしないこと
