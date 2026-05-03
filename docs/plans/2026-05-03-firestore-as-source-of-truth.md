# Firestore を真実のソースに一本化（A+B リファクタ）

## Context（背景）

これまでの sync 系バグ（court 巻き戻り / 同期重複 / matchHistory ワイプ /
セッション切替時の復活 / 参加者巻き戻り 等）はすべて **「ローカルに状態を持っている」**
ことが土台になっている。

具体的な構造的問題:

1. **真実の在処が 3 つある**: `localStorage`（zustand persist） / `sessionStorage`
   （`sync_base_${id}`） / Firestore。3-way merge が必要なのはこの構造から来ている。
2. **意図が失われる**: ユーザーは「支払をトグル」したのに、同期に渡るのは
   "player オブジェクトが変わった" という結果のみ。フィールド粒度マージを毎エンティティに
   書き足し続ける羽目になっている。
3. **リロード/タブ切替で base がズレる**: localStorage は残るが `lastSyncedState` は消えやすく、
   merge baseline を見失う。
4. **オフライン対応として弱い**: 競合解決は自前なので edge case を踏むたびに plan が増える。

オンライン専用にしてしまえば、Firestore の `enableIndexedDbPersistence`（既に有効）
＋ `runTransaction` で **同等以上のオフライン耐性が組込で得られる**。
merge レイヤーが不要になり、コード量で **1500 行以上** 削減できる。

## Goals

- Firestore document `sessions/{id}.gameState` を **唯一の真実のソース** にする
- すべてのミューテーションを `runTransaction(read → modify → write)` に統一
- `syncUtils.ts` の 3-way merge 群を撤去
- zustand persist を sync 系ストアから外す
- ローカルモード（Firebase 未設定 / 非共有セッション）を完全廃止

## Non-goals

- offline write キューの実装（Q3=全面ブロック で確定）
- 既存ローカルセッションのマイグレーション（Q2=破棄 で確定）
- 真の CRDT / op-based 同期（オーバーキル）

## Decisions（合意済み）

| # | Q | A |
|---|---|---|
| Q1 | ローカルモードの扱い | 完全廃止 |
| Q2 | 既存 localStorage データ | 破棄（告知のみ） |
| Q3 | オフライン書き込み | 全面ブロック（トーストで明示拒否） |
| Q4 | 真実のソース | Firestore 一本化 |
| Q5 | settings / accounting | session document 駆動に一本化 |
| Q5' | undo / presence | 現状維持（純ローカル） |
| Q6 | リリース戦略 | 段階的 5-PR |

## 現状アーキテクチャ

```
┌─────────────────┐   subscribe   ┌─────────────────┐
│  localStorage   │ ←──────────── │ zustand persist │
│ (badminton-*)   │               │  (各 store)     │
└─────────────────┘               └────────┬────────┘
                                           │ subscribe
                                           ▼
                                  ┌─────────────────┐
                                  │  schedulePush   │
                                  │  (300ms debounce)│
                                  └────────┬────────┘
                                           │
                          syncGameStateWithTransaction
                                           │
                                           ▼
┌─────────────────┐   onSnapshot   ┌─────────────────┐
│ sessionStorage  │                │  Firestore      │
│ sync_base_*     │ ←─── 3-way ─── │ sessions/{id}   │
└─────────────────┘    merge       └─────────────────┘
                          │
                          ▼
                  applyRemoteData
                          │
                          ▼
                  各 store.setState
```

問題: 3 系の永続化が並走し、書き込みごとに merge → push → onSnapshot → merge の
ループが発生する。fence は `lastPushedHash` / `lastPushedTime` / `pushBlockMs` /
`isSyncingFromRemote` / `lastSyncedState` の 5 種類。

## ターゲットアーキテクチャ

```
                  ┌─────────────────┐
                  │   UI Component  │
                  └────────┬────────┘
                           │ user action
                           ▼
                  ┌─────────────────┐
                  │ sessionMutations│
                  │  (transactional)│
                  └────────┬────────┘
                           │ runTransaction
                           ▼
                  ┌─────────────────┐
                  │   Firestore     │
                  │  sessions/{id}  │
                  └────────┬────────┘
                           │ onSnapshot
                           ▼
                  ┌─────────────────┐
                  │  各 store       │ ← persist 無し
                  │  setState 直接  │
                  └─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   UI Component  │
                  └─────────────────┘
```

- 永続化レイヤー: **Firestore のみ**（offline cache は SDK 内蔵 IndexedDB）
- 競合解決: 各オペレーションが独立 transaction なので 3-way merge 不要
- store の役割: 純粋に「Firestore document の現在値の React 反映キャッシュ」

## Phase 1: トランザクショナル ミューテーション API を集約

### 目的
すべての書き込み操作を `runTransaction(read → compute → write)` で表現できる API 集合を `src/services/sessionMutations.ts` に作る。**この時点ではまだ呼び出し側は変更しない**（既存の楽観更新 + push パスは残る）。Phase 2 以降で順次切り替える。

### スコープ

`MainPage.tsx` / `PlayerSelect.tsx` / `ReservationPage.tsx` / `ScoreInputPage.tsx` /
`SettingsPage.tsx` / `AccountingPage.tsx` の書き込み操作を網羅:

- **コート系**: `startGame` / `finishGame`（既存 `finishGameTransaction`） / `swapPlayer` / `clearCourt` / `assignToCourt` / `resizeCourts` / `removeCourt`
- **プレイヤー系**: `addPlayer` / `removePlayer` / `updatePlayer` / `toggleRest` / `applyPayment` / `toggleOperationStatus` / `incrementGamesPlayed`（実装済の playerStore action と同名）
- **予約系**: `addReservation` / `removeReservation` / `fulfillReservation` / `clearReservations`
- **マッチ履歴**: `removeMatch` / `updateMatchScore` / `clearHistory`
- **設定**: `setRecordScores` / `setContinuousMatchMode` / `setPracticeType`
- **会計**: `updateAccounting`

### 設計

```ts
// src/services/sessionMutations.ts
export async function applyPlayerPayment(
  sessionId: string,
  playerId: string,
  amount: number,
): Promise<GameState> {
  return runTransaction(db!, async (transaction) => {
    const snap = await transaction.get(doc(db!, 'sessions', sessionId));
    if (!snap.exists()) throw new SessionError('Session not found', 'not_found');
    const remote = snap.data().gameState as GameState;

    const next: GameState = {
      ...remote,
      players: remote.players.map((p) => {
        if (p.id !== playerId) return p;
        const current = p.operationStatus ?? { payment: false, roster: false, checkin: false };
        const newPayment = !current.payment;
        return {
          ...p,
          paymentAmount: amount,
          paymentTimestamp: newPayment ? Date.now() : p.paymentTimestamp,
          operationStatus: { ...current, payment: newPayment },
        };
      }),
    };

    transaction.update(snap.ref, {
      gameState: sanitize(next),
      updatedAt: serverTimestamp(),
      registeredPlayers: next.players.map((p) => p.name),
    });
    return next;
  });
}
```

- 全関数共通形式: `(sessionId, ...args) => Promise<GameState>`
- 失敗時は `SessionError` を throw（既存パターン踏襲）
- `aborted` は競合扱いで toast 通知

### Phase 1 完了条件

- [ ] 全書き込み操作の transactional API が `sessionMutations.ts` に定義されている
- [ ] 各関数のユニットテストが mock Firestore で書かれている
- [ ] 既存の動作は何も変わっていない（呼び出し側は未修正）
- [ ] `npm run build && npm run lint && npm run test:run` 全通

### Phase 1 想定変更

- 追加: `src/services/sessionMutations.ts`（~600 行想定）
- 追加: `src/services/sessionMutations.test.ts`
- 既存ファイル変更: `src/services/sessionService.ts` から `finishGameTransaction` を `sessionMutations.ts` に移動（互換 re-export 残す）

---

## Phase 2: 書き込み呼び出し側を transactional API に切替

### 目的

UI コンポーネントから `usePlayerStore` / `useGameStore` の mutation action を直接呼ぶ箇所を、`sessionMutations.X` に置き換える。これにより楽観更新 + push パスが全 mutation で **不要になる**。

### スコープ

ページごとに mutation 呼び出しを置換:

- `MainPage.tsx`: `handlePaymentConfirm` / `handleStartGame` / 終了ボタン / `handleSwapPlayer` / `handleAutoAssign` / `handleClearCourt` / `handleContinuousNext` 等
- `PlayerSelect.tsx`: `handleAddPlayers` / `handleDelete` / `handleEditSave` / `handlePaymentConfirm` / 名簿トグル
- `ReservationPage.tsx`: 予約追加 / 削除 / 完了
- `ScoreInputPage.tsx`: スコア更新
- `SettingsPage.tsx`: 設定変更
- `AccountingPage.tsx`: 会計更新

### 楽観更新の扱い

- mutation 関数が Firestore で書き込んだ後、**onSnapshot でストアが更新される** ので
  楽観更新は基本不要。ただし UX 上即時反応が欲しい場面（試合終了等）では、
  関数戻り値の `nextState` をそのまま `useXStore.setState({ ... })` に流して
  即時反映してもよい（onSnapshot で同じ値が再到着するだけ、副作用なし）。
- `prepareDirectTransaction` / `completeDirectTransaction` の guard は不要になる
  （writes が transactional なので push の競合がそもそも起きない）。

### Phase 2 完了条件

- [ ] 各ページの user action が `sessionMutations.X` 経由
- [ ] `useFirebaseSync` の `schedulePush` / `pushImmediate` 経路を使う mutation がゼロ
- [ ] 動作確認: 並行操作テスト（参加者管理 / コート / スコア）が両方残ること

---

## Phase 3: 読み取り側を onSnapshot 直結に切替

### 目的

`applyRemoteData` の 3-way merge を撤去し、onSnapshot を受信したら **そのまま store に setState** する。`lastSyncedState` / `sync_base_${id}` sessionStorage / `pushBlockMs` ガードを削除。zustand `persist` を sync 系ストアから外す。

### 変更点

- `useFirebaseSync.applyRemoteData`:

  ```ts
  // Before: mergeGameState(base, local, remote) → setState
  // After:
  usePlayerStore.setState({ players: gameState.players });
  useGameStore.setState({ courts: gameState.courts, matchHistory: gameState.matchHistory });
  useReservationStore.setState({ reservations: gameState.reservations });
  // settings / accounting も同様
  ```

- 削除: `lastSyncedState` / `saveSyncBase` / `loadSyncBase` / `sync_base_*` /
  `lastPushedHash` / `lastPushedTime` / `lastAppliedRemoteUpdatedAt` / `blockedUpdate` /
  `retryTimer` / `pushBlockMs` / `shouldApplyRemoteData`
- 削除: `playerStore.persist()` / `gameStore.persist()` / `reservationStore.persist()` /
  `settingsStore.persist()` / `accountingStore.persist()`
- 維持: `undoStore.persist()` / `presenceStore`（純ローカル）

### Loading state

persist が無くなるので、初回 mount 時にストアは空。**onSnapshot の最初の到着まで `null/loading` 状態** をストアに持たせ、UI が空配列を「データなし」と誤認しないようにする。

```ts
// 例: gameStore に loaded フラグ
interface GameState {
  loaded: boolean;
  courts: Court[];
  matchHistory: Match[];
}
```

ページ側は `if (!loaded) return <Spinner />` で表示分岐。

### Phase 3 完了条件

- [ ] `useFirebaseSync` から merge 関連コードが消えている
- [ ] sync 系 store から `persist` が消えている
- [ ] 初回 mount → onSnapshot → store 反映の flow が動く
- [ ] 並行操作テストが引き続き通る（mutation は transactional なので merge なしで OK）

---

## Phase 4: ローカルモード廃止

### 目的

Firebase 未設定時の localStorage フォールバックと、非共有セッション（`session.createdBy` なし）の経路を全削除。

### 変更点

- `src/lib/firebase.ts`: `db` が `null` のままなら起動エラー画面（既存セッションへの動作が無理になる旨を明示）
- `src/services/sessionService.ts`:
  - `useFirestore` フラグ削除
  - `localStorage.getItem('firebase_session_*')` 系の fallback 完全削除
  - 全関数を「Firestore 必須」前提に書き直し
- `src/pages/SessionCreate.tsx` / `SessionSelectPage.tsx`: ローカルセッション作成パス削除
- 各 page の `isShared` / `session?.createdBy` 分岐を削除（常に true 前提で簡素化）

### dev 環境

- `.env` に Firebase config を要求（README に明記）
- 推奨: dev 用に Firebase Emulator Suite を導入（別 plan で別途検討）

### Phase 4 完了条件

- [ ] `useFirestore` への参照が src 配下にゼロ
- [ ] `firebase_session_*` への参照がゼロ
- [ ] `isShared` 分岐がゼロ（あるいは全て常に true）

---

## Phase 5: クリーンアップ

### 目的

merge 関連の死コード削除 + ドキュメント整備。

### 変更点

- `src/lib/syncUtils.ts`:
  - 削除: `mergeNestedObject` / `mergeEntity` / `mergeEntitiesById` / `mergeMatchHistory` /
    `mergeSettings` / `mergeGameState` / `mergeCourt` / `mergeCourts` /
    `dedupPlayersAcrossCourts` / `mergeTeam` / `mergeRestingIds` / `SyncGameState` 型 /
    `hashGameState` / `shouldApplyRemoteData` / `getTimestampMillis`（sanitize 経由のみ残す可能性あり）
  - ファイル自体を削除する判断もあり
- `src/lib/syncUtils.test.ts`: 削除（ファイル自体）
- `src/hooks/useFirebaseSync.ts`: 大幅縮小（onSnapshot 監視のみ残る）
- `CLAUDE.md` / `README.md` / `DESIGN.md` の更新

### Phase 5 完了条件

- [ ] 死コード削除完了
- [ ] テスト通過
- [ ] ドキュメント更新

---

## テスト戦略

各 Phase ごとに:

1. **ユニットテスト**: `sessionMutations.X` を mock Firestore で
2. **統合テスト**: 既存の `sessionStore.test.ts` / `gameOperations.test.ts` を維持
3. **E2E**: `playwright` の既存シナリオを Phase 4 完了時にフル実行
4. **手動検証**: 2 タブで参加 → 並行操作 → 両方反映を毎 Phase 末に確認

## ロールバック戦略

- 各 Phase は独立 PR
- 問題発生時は Phase 単位で `git revert`
- 最終 fallback: `last-local-mode-supported` タグ（`f118661`）に戻る

## 残タスク・要相談

- Firebase Emulator Suite 導入（dev 環境用、別 plan）
- onSnapshot のリードコスト計測（Firestore 課金）
- アナウンス文（リリース前にユーザー向け、別途）

## 検証コマンド

```bash
npm run build
npm run lint
npm run test:run
npm run e2e # Phase 4 完了時
```
