# Firebase同期 第3弾レビュー完了

## 発見・修正した問題

### 🔴 問題11: useEffectの不安定な依存配列

**問題:**
```typescript
useEffect(() => {
  // subscription + initial push
}, [isShared, sessionId, schedulePush, pushGameState, session]);
```

- `session`が変わる度にeffectが再実行される → subscription多重登録のリスク
- `schedulePush`と`pushGameState`の両方が依存配列に → 不要な再実行
- `pushGameState`は`toast`に依存 → `toast`が変わると全体が再実行

**修正:**
1. `toast`と`navigate`をrefで保持（toastRef, navigateRef）
2. `pushGameState`の依存配列を空に（refのみ使用）
3. `schedulePush`もpushGameStateRefを使用して安定化
4. useEffectの依存配列を`[isShared, sessionId]`のみに縮小

---

### 🔴 問題12: onSnapshotリスナーの多重登録リスク

**問題:**
useEffectの依存配列が不安定なため、onSnapshotのリスナーが複数回登録される可能性。

**修正:**
依存配列を`[isShared, sessionId]`のみにし、sessionIdが変わった時のみ再実行。

---

### 🟡 問題13: 依存配列のコメント不足

**修正:**
空の依存配列にコメントを追加し、意図を明示。

---

## 修正後の構造

### useCallback/useEffectの依存配列

```typescript
// pushGameState: 依存なし（refとgetState()のみ）
const pushGameState = useCallback((sid: string) => {
  // ...
  toastRef.current.warning(...);
}, []);

// schedulePush: 依存なし（pushGameStateRefを使用）
const schedulePush = useCallback((sid: string) => {
  pushGameStateRef.current(sid);
}, []);

// applyRemoteData: 依存なし（refとgetState()のみ）
const applyRemoteData = useCallback((gameState, data) => {
  // ...
}, []);

// subscription effect: sessionIdのみ
useEffect(() => {
  // playerStore, gameStore, reservationStore のsubscription
  // 初回push
}, [isShared, sessionId]);

// onSnapshot effect: sessionIdのみ
useEffect(() => {
  // Firestore onSnapshot
  toastRef.current.error(...);
  navigateRef.current(...);
}, [isShared, sessionId]);
```

### 安定性の向上

- **不要な再実行を削減** → パフォーマンス向上
- **subscription多重登録を防止** → メモリリーク防止
- **effectの実行タイミングが明確** → デバッグしやすい

---

## まだ残っている可能性のある問題（低優先度）

### 🟡 MainPageの肥大化（1000行以上）

**影響:** 可読性、保守性の低下

**対策案:**
- コンポーネント分割（CourtCard, PlayerCard等）
- カスタムフック抽出

### 🟡 JSON.stringify比較のパフォーマンス

**影響:** 軽微（実用上は問題なし）

**対策案:**
- 軽量なdiff関数
- React.memoの活用

### 🟡 エラーバウンダリーの不在

**影響:** エラー発生時にアプリ全体がクラッシュ

**対策案:**
- ErrorBoundaryコンポーネントの追加

---

## 検証方法

1. **subscription多重登録のテスト**
   - Console で "subscription" をフィルタ
   - 同じsessionIdで複数回登録されていないか確認

2. **依存配列の安定性テスト**
   - React DevTools Profiler
   - useEffect の実行回数を確認

3. **メモリリークテスト**
   - Chrome DevTools Memory
   - ページ遷移を繰り返してメモリ使用量を確認

---

## 総括

Firebase同期の根本的な問題を3弾に渡って修正しました：

**第1弾（問題1-5）:**
- タイムスタンプ取得の堅牢化
- pullデバウンスの削除
- 詳細ログの追加

**第2弾（問題6-10）:**
- push開始時のタイムスタンプ記録
- try-finallyでのフラグ管理
- 参加者の初回pushスキップ

**第3弾（問題11-13）:**
- useEffectの依存配列の最適化
- subscription多重登録の防止
- ref経由での安定化

これにより、以下が実現されました：
- ✅ 古いデータでの上書きを防止
- ✅ push処理中のpullをブロック
- ✅ 参加者の空データpushを防止
- ✅ 不要な再実行を削減
- ✅ subscription多重登録を防止
