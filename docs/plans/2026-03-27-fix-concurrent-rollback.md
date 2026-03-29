# 同時操作による巻き戻り修正 + 勝敗記録モード共有

## Context

### 問題1: 同時操作で巻き戻りが多発
複数クライアントが同時に状態変更（休憩復帰、コート操作など）を行うと、後からpushしたクライアントが先の変更を上書きし、状態が巻き戻る。**ほぼ全ての操作が影響を受ける。**

**根本原因**: `syncGameStateWithTransaction()` がFirestoreトランザクション内でリモート状態を読むが、**ローカル状態で完全に上書き**する。マージが行われていない。

```
Client 1: PlayerA=active → push → Firestore: A=active, B=resting ✓
Client 2: PlayerB=active → push → Firestore: A=resting(!), B=active ← Aの変更消失
```

**影響範囲（巻き戻りが発生する操作一覧）:**
- 休憩トグル（toggleRest）
- コート配置（updateCourt）
- ゲーム開始（startGame）
- コート数変更（resizeCourts）
- 支払い・名簿ステータス（toggleOperationStatus）
- 予約成立（fulfillReservation）
- スコア編集（ScoreInputPage）
- ※finishGameのみ `finishGameTransaction` で保護済み

### 問題2: 勝敗記録モードが共有されない
`recordScores` は `settingsStore`（localStorage）に保存されており、Firebase同期の対象外。セッション参加者間で勝敗記録モードの設定が共有されない。

同様に、`continuousMatchMode`, `practiceType` もセッションレベルの設定なのにローカルのみ。

---

## 修正1: 3-way マージによる巻き戻り防止

### 方針

`finishGameTransaction` が既に「リモート状態を読んで計算関数を適用」するパターンを使用。同じアプローチを通常の同期にも適用する。

1. **baseState**（最後に同期した状態）を `useFirebaseSync` で追跡
2. push時にトランザクション内で **remoteState** を読む
3. `mergeGameState(base, local, remote)` で3-wayマージ
4. マージ結果を書き込む

### 変更ファイル

#### 1-A. `src/lib/syncUtils.ts` — マージ関数追加

新しい純粋関数を追加（GameState型のimportが必要）:

```typescript
import type { GameState } from '../services/sessionService';

/**
 * IDベースの3-wayマージ（汎用）
 * - base→localで変更があったアイテム: localを採用
 * - base→localで変更なしのアイテム: remoteを採用（他クライアントの変更保持）
 * - localのみに存在（追加）: 追加
 * - remoteのみに存在（他クライアントが追加）: 追加
 * - localで削除（baseにあるがlocalにない）: 削除
 */
function mergeById<T extends { id: string | number }>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
): T[]

/**
 * 3-wayマージ: base（最後の同期状態）をもとに、ローカル変更をリモートに適用
 */
export function mergeGameState(
  base: GameState | null,
  local: GameState,
  remote: GameState,
): GameState
```

**マージ戦略（エンティティ別）:**

| エンティティ | マージ方式 | 備考 |
|---|---|---|
| players | IDベース3-way | ローカル変更優先、リモートの他クライアント変更を保持 |
| courts | IDベース3-way | ローカル変更優先。ローカルのコート数を基準 |
| matchHistory | ID和集合 | append-only性質を活かし、union + startedAtソート |
| reservations | IDベース3-way | playersと同様 |

**変更検出**: `JSON.stringify(baseItem) !== JSON.stringify(localItem)`

#### 1-B. `src/services/sessionService.ts` — トランザクション内でマージ

`syncGameStateWithTransaction` のシグネチャに `baseState` を追加:

```typescript
export async function syncGameStateWithTransaction(
  sessionId: string,
  gameState: GameState,
  baseState?: GameState | null,  // 追加（後方互換のためoptional）
): Promise<void>
```

トランザクション内で:
```typescript
await runTransaction(db!, async (transaction) => {
  const snap = await transaction.get(docRef);
  const data = snap.data();
  const remoteState = data?.gameState as GameState | undefined;

  // リモート状態とbaseがある場合はマージ、なければ従来通り上書き
  const finalState = (remoteState && baseState)
    ? mergeGameState(baseState, gameState, remoteState)
    : gameState;

  transaction.update(docRef, {
    gameState: sanitize(finalState),
    registeredPlayers: finalState.players.map(p => p.name),
    updatedAt: serverTimestamp(),
  });
});
```

#### 1-C. `src/hooks/useFirebaseSync.ts` — baseState追跡

- `lastSyncedState` ref を追加 (`useRef<GameState | null>(null)`)
- **push成功時**: `lastSyncedState.current = pushした時点のgameState`
- **remote適用時**: `lastSyncedState.current = 適用したgameState`
- **pushGameState内**: `lastSyncedState.current` を `syncGameStateWithTransaction` の第3引数に渡す
- **completeDirectTransaction**: `lastSyncedState.current` を現在のローカルstateに更新
  - （finishGameTransactionは独自のマージを持つため、その後のpushで二重適用を防ぐ）

#### 1-D. `src/lib/syncUtils.test.ts` — テスト追加

`mergeGameState` のユニットテスト:
- 基本マージ: Client1がPlayerA変更、Client2がPlayerB変更 → 両方反映
- プレイヤー追加: ローカルで追加 + リモートで別の追加 → 両方追加
- プレイヤー削除: ローカルで削除 → リモートから消える
- matchHistory 和集合: 重複IDの排除 + 時系列ソート
- baseがnullの場合: localがそのまま使われる
- 同じプレイヤーを両方が変更: ローカル優先
- courtsマージ: ローカルでコート数変更 + リモートでコート状態変更

### エッジケース

1. **baseがnull**（初回push）: 従来通りローカルで上書き（後方互換）
2. **同じアイテムを両クライアントが変更**: ローカル優先（自分の操作を尊重）
3. **コート数の変更**: ローカルのコート配列が基準。リモートにしかないコートはマージ対象外
4. **directTransaction後**: `lastSyncedState`を現在のlocal stateに更新 → 次のpushは差分のみ

---

## 修正2: セッションレベル設定のFirebase同期

### 方針

`recordScores`, `continuousMatchMode`, `practiceType` をGameStateの `settings` フィールドとして同期する。settingsStoreは引き続きlocalStorageに永続化するが、オンラインモードではGameState経由でFirebase同期も行う。

### 変更ファイル

#### 2-A. `src/services/sessionService.ts` — GameState型拡張

```typescript
export interface GameState {
  players: Player[];
  courts: Court[];
  matchHistory: Match[];
  reservations: Reservation[];
  settings?: {                    // 追加
    recordScores?: boolean;
    continuousMatchMode?: boolean;
    practiceType?: '単' | '複' | '楽';
  };
}
```

#### 2-B. `src/hooks/useFirebaseSync.ts` — settings同期

**push側**: `pushGameState` で settingsStore の値も GameState に含める
```typescript
const { recordScores, continuousMatchMode, practiceType } = useSettingsStore.getState();
const gameState = {
  players, courts, matchHistory, reservations,
  settings: { recordScores, continuousMatchMode, practiceType },
};
```

**pull側**: `applyRemoteData` で settings を受信したら settingsStore に反映
```typescript
if (gameState.settings) {
  const { recordScores, continuousMatchMode, practiceType } = useSettingsStore.getState();
  if (gameState.settings.recordScores !== undefined && gameState.settings.recordScores !== recordScores) {
    useSettingsStore.getState().setRecordScores(gameState.settings.recordScores);
  }
  // continuousMatchMode, practiceType も同様
}
```

**注意**: settingsStoreの変更がpush triggerにならないよう、`isSyncingFromRemote` ガードを利用。settingsStoreにsubscribeを追加するか、pushGameState内で毎回読み込む形で対応。

#### 2-C. `src/lib/syncUtils.ts` — hashGameState拡張

settings フィールドもハッシュ計算に含める:
```typescript
export function hashGameState(data: {
  players: unknown[];
  courts: unknown[];
  matchHistory: unknown[];
  reservations: unknown[];
  settings?: unknown;
}): string {
  return JSON.stringify(data);
}
```

#### 2-D. マージ関数での settings 処理

`mergeGameState` 内で settings はローカル優先でマージ:
```typescript
settings: local.settings ?? remote.settings
```

---

## 実装順序

1. `syncUtils.ts` に `mergeGameState` と `mergeById` を追加
2. `syncUtils.test.ts` にテスト追加
3. `sessionService.ts` の `syncGameStateWithTransaction` を変更
4. `useFirebaseSync.ts` に `lastSyncedState` 追跡を追加
5. `sessionService.ts` の `GameState` に `settings` フィールド追加
6. `useFirebaseSync.ts` の push/pull に settings 同期を追加
7. `hashGameState` を拡張

## 検証

1. `npm run test:run` — 既存テスト全パス + 新しいmergeGameStateテスト
2. `npm run build` — TypeScript型エラーなし
3. `npm run lint` — リントパス
4. 手動テスト:
   - 2ブラウザで同時に休憩復帰 → 両方の変更が反映
   - 片方で勝敗記録モード変更 → もう片方に反映
   - finishGame後のcontinuousMode動作に影響なし
