# 複数人同時操作の巻き戻り修正

## Context

複数ユーザーが同時に操作すると状態が巻き戻る（休憩復帰、コート配置などが消える）。
3-wayマージのロジック（`syncUtils.ts`）は正しく実装・テスト済みだが、**マージ後の状態追跡バグ**により次回マージで誤ったベースが使われ、他クライアントの変更が消える。

## 根本原因

### 原因1（最重要）: push後のlastSyncedStateが実際のFirestore状態と乖離
`useFirebaseSync.ts:75-76` で push成功時に**ローカル状態**を記録しているが、トランザクション内で3-wayマージが発生した場合、実際にFirestoreに書き込まれたのは**マージ結果**。次回pushのベースが間違い、他クライアントの変更を消す。

### 原因2: completeDirectTransactionがstaleな状態をキャプチャ
`useFirebaseSync.ts:339-361` で `finishGameTransaction` 完了後にローカルストアから状態を読むが、トランザクションが書いた内容とローカルストアの内容が異なる場合がある。

### 原因3: 複数in-flightトランザクションの競合
pushが完了前に次のpushが開始され、古い`lastSyncedState`をベースにマージが走る。

---

## 修正計画（優先度順）

### Phase 1: トランザクションからマージ結果を返す（最大インパクト）

**`src/services/sessionService.ts`**
- `syncGameStateWithTransaction` の戻り値を `Promise<void>` → `Promise<GameState>` に変更
- トランザクション内で算出した `finalState`（マージ結果）を返す

**`src/hooks/useFirebaseSync.ts`**
- `pushGameState` で戻り値のマージ結果を使って状態を記録:
  ```typescript
  .then((mergedState) => {
    lastPushedHash.current = hashGameState(mergedState);
    lastSyncedState.current = mergedState;
  })
  ```

### Phase 2: finishGameTransactionも書き込み結果を返す

**`src/services/sessionService.ts`**
- `finishGameTransaction` の戻り値を `{ result: 'success'|'already_finished', writtenState?: GameState }` に変更

**`src/hooks/useFirebaseSync.ts`**
- `completeDirectTransaction` に `writtenState?: GameState` パラメータを追加
- 渡された場合はそれを `lastSyncedState` に設定（ローカルストア読み取りの代わりに）

**`src/pages/MainPage.tsx`**
- finishGameハンドラで `writtenState` を受け取り `completeDirectTransaction(writtenState)` に渡す

### Phase 3: Push直列化ロック

**`src/hooks/useFirebaseSync.ts`**
- `pushInFlight` ref (`useRef<Promise<void> | null>`) を追加
- push開始時: 前のpushが完了するまで待機 → 完了後にフレッシュなローカル状態を再取得してpush
- `.finally()` でロック解放
- 300msデバウンスと組み合わせることで、急激な変更もコアレスされる

### Phase 4: サイレント失敗からの回復

**`src/hooks/useFirebaseSync.ts`**
- `.catch()` でネットワークエラーと競合エラーを区別
- ネットワークエラー時は1秒後にリトライをスケジュール
- Phase 3の直列化ロックにより、リトライは安全にキューされる

### Phase 5（任意）: ハッシュ関数の軽量化

**`src/lib/syncUtils.ts`**
- `JSON.stringify` の結果に対してdjb2等の軽量ハッシュを適用
- メモリ使用量削減（フルJSON文字列→固定長ハッシュ）

---

## 対象ファイル

| ファイル | Phase | 変更内容 |
|---------|-------|---------|
| `src/services/sessionService.ts` | 1,2 | 戻り値をGameStateに変更 |
| `src/hooks/useFirebaseSync.ts` | 1,2,3,4 | 状態追跡修正 + 直列化ロック |
| `src/pages/MainPage.tsx` | 2 | finishGame結果をsyncに渡す |
| `src/lib/syncUtils.ts` | 5 | ハッシュ軽量化 |
| `src/lib/syncUtils.test.ts` | 1 | マルチサイクルマージテスト追加 |

## 検証

1. `npm run test:run` — 既存テスト全パス + 新規テスト
2. `npm run build && npm run lint` — ビルド・lint通過
3. **手動テスト**: 2ブラウザで以下を同時実行し巻き戻りが起きないことを確認
   - 異なるプレイヤーの休憩トグル
   - 同時コート配置
   - 片方がfinishGameしながら、もう片方が休憩トグル
   - 10回連続の高速操作
