# 2026-04-26: 開始した試合が巻き戻る不具合の修正

## 背景

複数ユーザーで同じセッションを操作している際、片方のユーザーが「開始」した試合が直後に
未開始の状態に巻き戻る事象が報告されていた。`useFirebaseSync` の pull/push 経路と
`MainPage` のコート増減ハンドラを調査した結果、以下 3 つの根本原因を特定した。

### 原因①: pull 側で courts/players/matchHistory を 3-way マージせず上書き
`useFirebaseSync.ts` の `applyRemoteData` は、`shouldApplyRemoteData` のチェックを
通過した後、リモートの `players/courts/matchHistory/reservations` をローカル store に
丸ごと代入していた。`schedulePush` は 300ms のデバウンスを持つため、ローカルで
「開始」操作 → store 更新 → 300ms 待ち の間に他クライアントの onSnapshot が届くと、
ローカルの未 push 変更が pull 側で上書きされてしまう。`pushBlockMs=500` のガードは
**push 後** の 500ms をブロックする仕組みで、push 前のペンディング状態は守らない。

### 原因②: コート増減で baseState を渡さず全上書き
`MainPage.tsx` の `handleAddCourt` / `handleRemoveCourt` は、
`syncGameStateWithTransaction(sessionId, gameState)` を **第 3 引数 `baseState` 抜き** で
呼んでいた。`sessionService.ts` の実装は `baseState` が無いと 3-way マージをスキップして
リモート状態を完全に上書きするため、他クライアントで進行中の試合（`isPlaying:true`）が
消えていた。さらに `prepareDirectTransaction` も呼ばれていなかったため、ローカル変更による
`schedulePush` も並走しており、`completeDirectTransaction` も未実施で `lastSyncedState`
が更新されていなかった。

### 原因③: push 失敗時に push ガードまでリセット
`pushGameState` の `.catch` で `lastPushedHash` / `lastPushedTime` が無条件にゼロクリア
されていた。conflict 時はローカルの楽観的更新を保護したい一方で、guard を弱めると次の
snapshot が原因①の上書き経路に直行し、巻き戻りの発生確率を高めていた。

## 実装

### 1. `applyRemoteData` の 3-way マージ化
`useFirebaseSync.ts:215-251`
- `mergeGameState(base, local, remote)` を pull 側にも導入。
- `base = lastSyncedState.current`（無ければリモートを採用）。
- マージ結果を各 store に setState し、差分判定は `localState` と `merged` を比較。
- `lastSyncedState.current` は **incoming remote** に更新（次回 push の base はサーバが
  知っている最新状態を表す）。
- 試合開始通知 (`checkMatchStartNotifications`) も `localState.courts` → `merged.courts`
  の差分で評価するよう更新。

### 2. `pushImmediate` API の追加
`useFirebaseSync.ts:444-472`, `FirebaseSyncContext.tsx`
- デバウンスをスキップして即座に push を直列実行する API を追加。
- 内部の `pushInFlight` チェーンに乗せ、後続 push を阻害しないよう常に resolve させる。
- 失敗は呼び出し側に reject として伝播させる。
- 戻り値は 3-way マージ後の `GameState`（`completeDirectTransaction` で base 更新に使用）。

### 3. `handleAddCourt` / `handleRemoveCourt` の Direct Transaction 化
`MainPage.tsx:201-258`
- `prepareDirectTransaction()` で push timer 停止 + `isSyncingFromRemote=true`。
- ローカル状態を変更（`resizeCourts` / `removeCourtById` / `updateConfig` 等）。
- `pushImmediate()` で 3-way マージ付き push を実行。
- `completeDirectTransaction(written)` で `lastSyncedState` を確定。
- 旧来の「`syncGameStateWithTransaction` を直接 import して baseState 抜きで呼ぶ」
  ロジックを削除。

### 4. push 失敗時の guard リセット最適化
`useFirebaseSync.ts:108-125`
- `conflict` 時は guard を維持（次の onSnapshot で 3-way マージが正しく解決する）。
- ネットワーク失敗等は従来通り guard をクリア（永久ブロックを避ける）。

## テスト

### 追加したユニットテスト (`src/lib/syncUtils.test.ts`)
1. ローカルで試合開始 + リモートで別コート配置 → 開始保持（巻き戻り再現の最小ケース）
2. ローカルで試合終了 + リモートはまだ playing → 終了保持
3. ローカル未変更 + リモートで他クライアントが終了 → リモート反映
4. ローカルで試合開始 + リモートでコート追加 → 両方反映
5. ローカル未変更 + リモートでコート追加 → リモート追加反映
6. ローカルでコート追加 + リモートで他コート開始 → 両方反映
7. ローカルでコート削除 + リモートで残コート開始 → 両方反映

### 検証コマンド
```
npm run build      # ✅ tsc -b && vite build
npm run lint       # ✅ eslint .
npm run test:run   # ✅ 264 tests passed
```

## 副次効果
- `players` / `matchHistory` でも同種の巻き戻り（休憩切替・支払・スコア編集中の上書き）
  が pull 側で防がれる。
- `reservations` でも同様に他クライアント変更を保持しながらローカル変更を保護できる。
- `settings` は既存のフィールド単位 3-way マージで対応済み（変更なし）。

## 手動検証推奨項目
1. 2 ブラウザで同一セッションに参加。
2. 片方で「開始」→ もう片方で休憩トグル → 開始が保持されること。
3. 片方で「+コート」を連打しつつ、もう片方で別コートで開始 → 開始が消えないこと。
4. ネットワークを一時的に切断 → 「開始」操作 → 再接続 → 試合状態が保持されること。
