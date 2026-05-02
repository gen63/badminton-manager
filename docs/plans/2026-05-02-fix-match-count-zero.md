# 2026-05-02: 同一セッション再入室時に matchHistory がワイプされる不具合の修正

## 背景

ユーザー報告: 「試合カウントがゼロになることがある、そんなはずはない」

`SessionSelectPage` のセッション一覧で表示される試合数バッジ（`session.matchCount > 0` が条件）が、
本来は数試合行われているはずのセッションで消える事象が発生している。
`docToSession` (`src/services/sessionService.ts:86`) は `matchCount` を
`gameState.matchHistory.length` から導出しているため、Firestore 上の `gameState.matchHistory`
配列自体が `[]` になっていることを意味する。

## 根本原因

`SessionJoinPage.handleJoin` (`src/pages/SessionJoinPage.tsx:138-`) において、
**同一オンラインセッションへの再入室**（force 再入室、または participants から外れていた等で
非 force でも継続するケース）で以下のレースが発生する。

### レースの内訳
1. `previousSession.id === sessionId` のため、別セッション切替時の保護 `prepareDirectTransaction()`
   が呼ばれない（line 147-159 の if ブロックが skip）。よって `isSyncingFromRemote.current = false`
   のまま。
2. `joinSession` 完了後、`clearPlayers/clearHistory/clearReservations/clearRecords/clearAll`
   が走り、gameStore.matchHistory が `[]` になる。
3. `useFirebaseSync` の gameStore subscriber が `isSyncingFromRemote=false` なので
   `schedulePush(sessionId)` をキュー（300ms debounce）。
4. その間に `subscribeToGameState` の onSnapshot が間に合えば
   `useGameStore.setState({ matchHistory: [...actual matches] })` で復元され、再度の
   `schedulePush` でタイマーがリセットされ、最終的な push は正常な状態を流す。
5. **しかし、ネットワーク遅延・cache miss 等で onSnapshot が 300ms 以内に届かなければ、
   先にデバウンス push が発火**:
   - `gameState = getCurrentGameState()` → matchHistory: `[]`
   - `baseState = lastSyncedState.current` → 直前まで使っていた matchHistory: `[matches]`
   - `syncGameStateWithTransaction` 内で `mergeMatchHistory(base=[matches], local=[], remote=[matches])`
     を実行
   - 各 remote item は baseMap に存在するため「local 側で削除された」と解釈され、
     結果は `[]` になる (`src/lib/syncUtils.ts:433-471`)
   - Firestore に `gameState.matchHistory: []` が書き込まれる

これにより `docToSession` の `matchCount` が 0 になり、SessionSelectPage の試合数バッジが消える。

### 発生シナリオ
- 別端末で同一セッションを開いた際に `force` 再入室した場合
- 同一端末でも、URL 直接アクセス→「入室する」→「再入室の確認」ダイアログ→「再入室」と進むと
  該当のクリア処理が必ず走る
- participants から外れた状態で再入室した場合（非 force 経路）

## 設計方針

### アプローチ A: 同一オンラインセッション再入室時はクリア処理をスキップ（採用）

ローカルストア (`gameStore` / `playerStore` / `reservationStore`) の現状値は
そのセッションの正しいデータそのものなので、わざわざクリアする必要がない。
`subscribeToGameState` 経由の onSnapshot で最新値で上書きされるため、
古い値が混入するリスクは無い。

メリット:
- 1 ファイルの差分で済む
- 既存の「別セッションへの切替時はクリア」セマンティクスを維持
- `prepareDirectTransaction` を増やす必要がないため、`completeDirectTransaction` の
  追加呼び出しなど副作用も増えない

検討した代替案:
- アプローチ B: 常に `prepareDirectTransaction()` してから clear → subscribe 完了で
  `completeDirectTransaction()`。しかし、同一セッション時は useFirebaseSync の effect
  cleanup が走らないため `isSyncingFromRemote` を別経路で false に戻す必要があり、
  実装が複雑化する。
- アプローチ C: `pushGameState` 側で「local が空 + base が非空」のときに wipe を抑止。
  しかし matchHistory の正当な「全削除」操作（管理者の試合リセット）と区別できない。

## 実装

### `src/pages/SessionJoinPage.tsx`
- `handleJoin` 冒頭で `isSameOnlineSession` を判定。
- 同一オンラインセッション再入室時はローカルストアのクリアを行わない。
- 別セッション切替・新規入室時は従来通りクリア。

```ts
const isSameOnlineSession =
  !!previousSession?.id &&
  !!previousSession.createdBy &&
  previousSession.id === sessionId;

// ... 別セッション処理 ...

if (!isSameOnlineSession) {
  usePlayerStore.getState().clearPlayers();
  useGameStore.getState().clearHistory();
  useReservationStore.getState().clearReservations();
  useAccountingStore.getState().clearRecords();
  useUndoStore.getState().clearAll();
}
```

### テスト
`src/lib/syncUtils.test.ts` に回帰テストを追加:
- `mergeMatchHistory(base=[m1,m2], local=[], remote=[m1,m2])` が `[]` を返すことを
  明示的に確認するテスト（仕様の文書化）
- 同 case で local が `[m1,m2]` のままなら `[m1,m2]` が保たれることを確認

## 検証コマンド
```
npm run build
npm run lint
npm run test:run
```

## 手動検証推奨項目
1. 同一セッションを 2 ブラウザで開き、片方で 3 試合終了。
2. もう片方のブラウザでセッション URL を開き「入室する」→「再入室」を選択。
3. SessionSelectPage に戻ったとき、当該セッションに「3 試合」バッジが残っていること。
4. 別セッションへの切替・新規セッション作成でローカル残骸が混入しないこと（既存挙動の維持確認）。
