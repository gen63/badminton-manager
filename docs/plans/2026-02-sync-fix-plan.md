# Firebase同期 修正プラン

## 問題の本質

PWAでブラウザの変更が反映されない、または古いデータで上書きされる。

## 発見した問題

### 1. updatedAtの取得失敗時のフォールバック（最重要）
- 現状: `|| 0` でフォールバック
- 問題: 一度でも取得失敗すると、以降すべてのデータがブロックされる
- 修正: エラー検出とログ、適切なフォールバック

### 2. Firestoreタイムスタンプ型の不正確な扱い
- 現状: `.seconds * 1000` で変換
- 問題: SDKバージョンや環境で動作が異なる
- 修正: `.toMillis()` メソッドを使用

### 3. デバウンス実装の再検討
- 現状: pullデバウンス100ms、pushデバウンス300ms
- 問題: 複雑なタイミングで古いデータが残る可能性
- 修正: デバウンスを削除し、タイムスタンプベースの単純な判定のみに

### 4. 楽観的UI更新の欠如
- 現状: リモートデータを常に信頼
- 問題: ネットワーク遅延でUI更新が遅れる、古いデータが後から来る
- 修正: 自分の操作は即座にローカル反映、pullは「確認」のみ

## 推奨される修正手順

### Phase 1: 緊急修正（即座に実施）
1. updatedAtのフォールバック値を修正
2. タイムスタンプ取得の詳細ログ追加
3. Timestamp.toMillis()を使用

### Phase 2: デバウンス削除（1日後）
1. pullデバウンスを削除
2. pushデバウンスは維持（通信削減のため）
3. タイムスタンプとハッシュのみで判定

### Phase 3: 楽観的UI更新（数日後、時間がある時）
1. 自分の操作はローカルに即座に反映
2. Firestoreへのpushは非同期
3. pullは「確認」として扱い、自分が変更した部分は上書きしない

## 実装方針

### 即座に実装する修正

```typescript
// タイムスタンプ取得の堅牢化
function getTimestampMillis(timestamp: unknown): number | null {
  if (!timestamp) return null;
  if (typeof timestamp === 'number') return timestamp;
  
  // Firestore Timestamp型
  if (typeof timestamp === 'object' && timestamp !== null) {
    if ('toMillis' in timestamp && typeof timestamp.toMillis === 'function') {
      return timestamp.toMillis();
    }
    if ('seconds' in timestamp && typeof timestamp.seconds === 'number') {
      return timestamp.seconds * 1000;
    }
  }
  
  return null;
}

// applyRemoteDataの修正
const remoteUpdatedAt = getTimestampMillis(data.updatedAt);
if (remoteUpdatedAt === null) {
  console.error('[FirebaseSync] ❌ Failed to parse updatedAt:', data.updatedAt);
  return; // タイムスタンプ取得失敗時はデータ適用しない
}

// 古いデータチェック
if (lastAppliedRemoteUpdatedAt.current > 0 && remoteUpdatedAt <= lastAppliedRemoteUpdatedAt.current) {
  console.log('[FirebaseSync] ⏭️  SKIP: older data');
  return;
}
```

### デバウンス削除案

```typescript
// pullデバウンスを削除し、即座に判定・適用
const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
  if (!snap.exists()) return;
  
  const data = snap.data();
  const gameState = data.gameState;
  if (!gameState) return;
  
  // デバウンスなし、即座に判定
  applyRemoteData(gameState, data);
});
```

## 検証方法

1. 詳細ログで以下を確認
   - `data.updatedAt`の生値
   - `remoteUpdatedAt`の変換結果
   - `lastAppliedRemoteUpdatedAt`の推移
   - SKIP/APPLYの判定理由

2. 2つのブラウザで同時テスト
   - ブラウザA: プレイヤーを休憩
   - PWA B: 反映されるか？何秒後？
   - ログで判定フローを確認

3. ネットワーク遅延のシミュレーション
   - Chrome DevTools → Network → Slow 3G
   - 古いデータが後から来た時の動作確認
