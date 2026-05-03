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

### 別経路の同種バグ: 別セッションから戻ってきた creator の即時 push

`useFirebaseSync` の effect 内には「セッション作成者の場合は mount 時に即時 push を発火」
する処理がある (`src/hooks/useFirebaseSync.ts:338-340`)。これは creator が
オフラインで行ったローカル変更をオンライン復帰時に push するためだが、
**セッション切替直後**には別の wipe 経路を生む:

1. ユーザーは過去にセッション B（自分が creator）を使っていた → `sessionStorage`
   に `sync_base_B = {matchHistory: [m1, m2], ...}` が保存される。
2. その後セッション A に切り替えて使用、また B に戻ろうと SessionJoinPage 経由で
   再入室する（A→B、別セッション扱い）。
3. handleJoin 内で `prepareDirectTransaction()` → clearXXX → `initializeSession(B)`
   → `setCurrentUser` → `subscribeToGameState(B, ...)` の順で進行。
4. React render で `useFirebaseSync` の cleanup（A 用）が走り、`lastSyncedState=null`
   などをリセット。直後に新 effect が B 用に起動:
   - `lastSyncedState = loadSyncBase(B) ?? getCurrentGameState()` → sessionStorage に
     残っていた **古い [m1, m2]** が復元される
   - gameStore は clearXXX 直後で **空**
   - `isCreator=true` → `pushGameStateRef.current(B)` が即時発火
5. doPush は `getCurrentGameState()` を読み取る時点でまだ subscribe コールバックが
   届いておらず、`local = matchHistory: []`、`base = [m1, m2]`。
   `mergeMatchHistory(base=[m1,m2], local=[], remote=[m1,m2,m3])` が `[m3]` を返し、
   m1/m2 が Firestore からワイプされる。

### アプローチ A: 同一オンラインセッション再入室時はクリア処理をスキップ（採用）

SessionJoinPage の同一セッション再入室分:
ローカルストア (`gameStore` / `playerStore` / `reservationStore`) の現状値は
そのセッションの正しいデータそのものなので、わざわざクリアする必要がない。
`subscribeToGameState` 経由の onSnapshot で最新値で上書きされるため、
古い値が混入するリスクは無い。

検討した代替案:
- アプローチ B: 常に `prepareDirectTransaction()` してから clear → subscribe 完了で
  `completeDirectTransaction()`。しかし、同一セッション時は useFirebaseSync の effect
  cleanup が走らないため `isSyncingFromRemote` を別経路で false に戻す必要があり、
  実装が複雑化する。
- アプローチ C: `pushGameState` 側で「local が空 + base が非空」のときに wipe を抑止。
  しかし matchHistory の正当な「全削除」操作（管理者の試合リセット）と区別できない。

### アプローチ D: セッション切替直後の即時 creator push をスキップ（採用）

useFirebaseSync の effect で、`previousSessionIdRef` を使って「直前まで別セッション
だったか」を判定する。セッション切替直後と判定された場合は即時 creator push を
スキップし、`subscribeToGameState` の onSnapshot で local が最新化されてから
subscriber 経由で push される経路に委ねる。

メリット:
- subscriber 経由 push は local がすでに最新の Firestore 状態と一致した状態で発火
  するため、stale な base が残っていても merge 結果が正しくなる（local と remote が
  ほぼ同一なので、union が取られる）
- 通常のリロード（同一 sessionId のまま再 mount）や cold start では従来通り
  即時 push が走り、creator のオフライン変更がただちに sync される

検討した代替案:
- 即時 push を完全削除: SessionCreate の初回 push と onSnapshot で十分にも見えるが、
  creator がオフラインでローカル変更を蓄積しオンライン復帰した直後（同一セッション
  のままアプリ再起動）の push 経路を失うため見送り。
- session 切替時に `sessionStorage.removeItem('sync_base_${oldSessionId}')`:
  別端末/タブからの戻りで sessionStorage が空でも被害は出ないが、
  `sync_base_${currentSessionId}` 側の stale が直接の問題なので別問題。
  またページ遷移を跨ぐ base 保持の意図に反する。

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

### `src/hooks/useFirebaseSync.ts`
- `previousSessionIdRef` を追加し、cleanup で「これから抜ける sessionId」を記録する。
- effect 起動時、`previousSessionIdRef.current !== undefined &&
  previousSessionIdRef.current !== sessionId` ならセッション切替直後と判断し、
  即時 creator push をスキップする。

```ts
const previousSessionIdRef = useRef<string | undefined>(undefined);
// ...
const isSessionSwitch =
  previousSessionIdRef.current !== undefined &&
  previousSessionIdRef.current !== sessionId;
if (isCreator && !isSessionSwitch) {
  pushGameStateRef.current(sessionId);
}
// cleanup 末尾:
previousSessionIdRef.current = sessionId;
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
5. creator として A→B→A の順にセッション切替を行い、A の試合数バッジが減らないこと。
