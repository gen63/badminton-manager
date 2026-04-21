# プレゼンス表示による二重操作抑止

## Context

複数人が同じセッションに参加するオンラインモードで、同じ操作（休憩切替・コート割当・試合開始/終了・支払い記録など）を二人が同時に行ってしまう二重操作リスクがある。

過去には技術的な衝突解決として 3-way merge (`docs/plans/2026-03-27-fix-concurrent-rollback.md`, `docs/plans/2026-03-29-fix-concurrent-sync-rollback.md`) を導入済みだが、これは「矛盾なく両方反映する」仕組みであり、**人同士の意図の衝突**（同じアクションを二人が別々にやる）は防げない。

UXポリシーとして「ロックはしない」を維持しつつ、「今誰が画面を見ており、最近触っているか」を画面上に可視化することで、**社会的な抑止**をかけて二重操作を減らすのが本プランの狙い。

## 仕様（ユーザー回答反映）

- **粒度**: 画面レベルのみ（最終タップ対象までは追跡しない）
- **対象画面**: MainPage のみ
- **アクティブ判定**:
  - 強シグナル（操作しそう）: 最終タップから **15秒** 以内
  - 弱シグナル（見ているだけ）: 最終ハートビートから **45秒** 以内
- **除外**: 自分自身はインジケータに表示しない

## データモデル

`sessions/{sessionId}` ドキュメントに `presence` マップを追加（埋め込み）。

```ts
// src/types/session.ts に追加
export interface PresenceEntry {
  lastSeenAt: number;  // 最終ハートビート (Unix ms, クライアント時刻)
  lastTapAt?: number;  // 最終タップ (Unix ms)
}

export interface Session {
  // ...既存フィールド
  presence?: { [username: string]: PresenceEntry };
}
```

- 既に `useRealtimeSession` と `useFirebaseSync` の両方がセッション doc を購読しているため、サブコレクションより追加コストが小さい。
- アクティブ判定はクライアント側（描画時にフィルタ）。

## 実装ステップ

### 1. 型定義

- `src/types/session.ts`: `PresenceEntry` と `Session.presence` を追加。

### 2. サービス層（`src/services/sessionService.ts`）

- `docToSession` で `data.presence` をそのまま引き回す。
- 新規 `writePresence(sessionId, username, patch: Partial<PresenceEntry>)`:
  - **`FieldPath` を使用** する（`['presence', username, 'lastSeenAt']`）。ドット記法だとユーザー名に `.` が含まれる場合にキー階層が壊れるため。
  - 例: `updateDoc(ref, new FieldPath('presence', username, 'lastSeenAt'), ts, new FieldPath('presence', username, 'lastTapAt'), ts)` のような呼び出し。型安全性のため薄いラッパで包む。
  - **`updatedAt` は一切触らない**。既存の `updateSession`（L188）は `updatedAt: serverTimestamp()` を自動付与するため使わない。直接 `updateDoc` を使う。
- 新規 `clearPresence(sessionId, username)`:
  - `updateDoc(ref, new FieldPath('presence', username), deleteField())`。
- **既存 transaction との非干渉**: `syncGameStateWithTransaction`（L352-）と `finishGameTransaction`（L415-）はいずれも `transaction.update(docRef, { gameState, registeredPlayers, firstMatchStartedAt, updatedAt })` で **部分更新**のため、`presence` フィールドは保持される ✓（プラン実装時にも手動確認）。

### 3. プレゼンス専用ストア（新規）

**`src/stores/sessionStore.ts` を汚さない**。同ストアは `persist({ name: 'badminton-session' })` で localStorage に永続化されており、`updateSession` 経由で presence を流すとハートビートのたびに localStorage 書き込みが発生するため。

代わりに `src/stores/presenceStore.ts` を新設:

```ts
type PresenceMap = { [username: string]: PresenceEntry };
interface PresenceState {
  remotePresence: PresenceMap;
  setRemotePresence: (presence: PresenceMap) => void;
}
```

- `persist` なし、揮発ストア。
- `useRealtimeSession` の `updateSession` 呼び出しは既存通り変更せず、**別途** subscribeToSession のコールバック内で `presenceStore.setRemotePresence(session.presence ?? {})` を呼ぶ差分だけ加える。

### 4. `useRealtimeSession` の改修（`src/hooks/useRealtimeSession.ts`）

- コールバック内で `docToSession` が返す `session` から `presence` を取り出し、`usePresenceStore.getState().setRemotePresence(session.presence ?? {})` を呼ぶ。
- 既存の `updateSession({config, participants, ...})` 呼び出しに `presence` は **追加しない**（sessionStore 永続化を避けるため）。
- `docToSession` で presence を型安全に返す必要があるので、`Session` 型に presence を追加済みであることを利用する。

### 5. プレゼンス管理フック（新規 `src/hooks/usePresence.ts`）

- 入力: `sessionId: string | null`, `currentUser: string | null`
- ガード: どちらか null、または `document.visibilityState !== 'visible'` のとき何もしない。
- 動作:
  - **マウント時 / visibility=visible 復帰時**: 即 `writePresence(sessionId, currentUser, { lastSeenAt: now })`
  - **ハートビート**: `setInterval(20_000)` で `writePresence({ lastSeenAt: now })`。直近 15秒以内に既に書いていればスキップ（ref で最終書込時刻を保持）。
  - **タップ検知**: `window.addEventListener('pointerdown', ...)` を1つだけ張る。3秒スロットル（ref 管理）。`writePresence({ lastSeenAt: now, lastTapAt: now })`。
  - **クリーンアップ（unmount / visibilitychange=hidden / beforeunload）**: `clearPresence(sessionId, currentUser)` を呼ぶ。
    - **注記**: `beforeunload` では `updateDoc` の async 完了は保証されない。タブクラッシュや強制終了時もエントリが残る。これは **45秒の client-side フィルタで吸収** する（描画に影響しない）。Firestore 上のエントリだけが最悪数分残る可能性がある（ステップ6で補足）。
- エラー: 書き込み失敗は `console.warn` のみ（補助機能なので UX を止めない）。
- **React StrictMode 対策**: dev での二重 mount/unmount は write → clear → write の順で発生するが、いずれも冪等なので問題なし。

### 6. 漂流エントリの簡易掃除

長時間稼働セッションでブラウザクラッシュ等により `presence.<user>` が削除されずに残るケース対策:

- `usePresence` の最初のハートビート時に、**自分自身のハートビートと一緒に** 「5分以上 `lastSeenAt` が古い他ユーザーのエントリ」を削除するプルーニング書き込みを入れる。
- 実装: `subscribeToSession` が返す最新 `presence` を見て、条件を満たす key に対して `deleteField()` を付けた単一の `updateDoc` を発行。
- 競合安全性: 複数人が同時に掃除を試みても、`deleteField` は冪等。最悪 N 人分の書き込みが走るだけ。
- 頻度を抑えるため、このプルーニングは **マウント時の1回のみ** 実行する（毎回のハートビートではやらない）。

### 7. UI コンポーネント（新規 `src/components/PresenceIndicator.tsx`）

- Props:
  - `presence: { [username: string]: PresenceEntry }` (presenceStore から取得)
  - `currentUser: string | null`
- 内部ロジック（`useEffect` で 1秒ごとに tick する `useState`、再評価用）:
  - 自分を除外
  - `now - lastSeenAt > 45_000` のエントリを除外
  - 残りのうち `lastTapAt && now - lastTapAt <= 15_000` のエントリを「操作中」扱い
- 表示（DESIGN.md 準拠・情報バナーと同列・8pxグリッド）:
  - 誰もいなければ `return null`
  - 「操作中」が 1人以上: オレンジ系 `text-orange-600`、アイコン `Hand` (lucide) + 軽い pulse、テキスト例: 「○○さんが操作中」
  - 「操作中」ゼロ・「閲覧中」あり: `text-muted-foreground`、アイコン `Eye`、テキスト例: 「○○さんが閲覧中」
  - 2人以上: 「○○ と △△ が操作中」 / 3人以上: 「○○ 他N名が操作中」
  - 名前は最大12文字で切って `…` を付ける
  - カードスタイルは DESIGN.md の Level 1 elevation を借りた軽量バッジ

### 8. MainPage に組み込み（`src/pages/MainPage.tsx`）

- L33 の `useRealtimeSession(...)` の直後に `usePresence(isSharedSession ? session?.id ?? null : null, currentUser)`。
- JSX 内、ヘッダー/情報バナーの付近に `<PresenceIndicator presence={remotePresence} currentUser={currentUser} />` を挿入。`remotePresence` は `usePresenceStore` から取得。
- ローカルモード（`!session?.createdBy`）や `currentUser` 未設定時は `usePresence` が no-op かつ `PresenceIndicator` も空集合で null 返却。

### 9. onSnapshot 干渉の verification（実装時に要確認）

presence 書き込みは `updatedAt` を変更しないため、理論上は:

- `useFirebaseSync` onSnapshot（`src/hooks/useFirebaseSync.ts:348`）は発火する。
- `applyRemoteData` 内で `remoteUpdatedAt = getTimestampMillis(data.updatedAt)` は前回と同値 → `shouldApplyRemoteData` が `remoteUpdatedAt <= lastAppliedRemoteUpdatedAt.current` 判定で早期 return するはず。
- `incomingHash === lastPushedHash` または同じ → 同値判定でスキップ。

**実装時チェックリスト**:
- `src/lib/syncUtils.ts` の `shouldApplyRemoteData` を読み、`updatedAt` 非更新ケースで確実にスキップされることを確認
- 実機テストで、他ユーザーのハートビートが MainPage のプレイヤー/コート状態再描画を引き起こさないことを DevTools で確認（不要な `applyRemoteData` 実行がないか）

## 書き込みコスト見積もり

- ハートビート: 20秒ごと × アクティブユーザー数
- タップ: 3秒スロットル、「操作中」中はハートビート側スキップが効き実質ハートビート以下
- 5人同時利用想定: < 100 writes/min/session = < 6000 writes/hour。無料枠（20k writes/day × 30日）内で余裕
- リード: 各 write が N ユーザーに snapshot として届くので N² オーダーだが、5人なら問題なし

## 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/types/session.ts` | `PresenceEntry` 型と `Session.presence` 追加 |
| `src/services/sessionService.ts` | `docToSession` 拡張、`writePresence`/`clearPresence` 新規、`FieldPath` 使用 |
| `src/hooks/useRealtimeSession.ts` | `presence` を `presenceStore` に流す（`sessionStore` には流さない） |
| `src/stores/presenceStore.ts` | **新規** 非永続ストア |
| `src/hooks/usePresence.ts` | **新規** ハートビート/タップ/クリーンアップ/初回プルーニング |
| `src/components/PresenceIndicator.tsx` | **新規** 表示コンポーネント |
| `src/pages/MainPage.tsx` | `usePresence` 呼び出しと `<PresenceIndicator/>` 配置 |

## 検証手順

1. **ビルド/リント/テスト** (CLAUDE.md 必須)
   ```bash
   npm run build
   npm run lint
   npm run test:run
   ```
2. **手動 E2E**（2ブラウザ or 1ブラウザ2プロファイルで同一セッションを開く）
   - (a) A だけ MainPage → B 画面では何も出ない
   - (b) A が休憩ボタン等タップ → B 画面に「A さんが操作中」がオレンジで15秒表示 → 15秒経つと「A さんが閲覧中」にトーンダウン
   - (c) A がタブを裏に → B 画面では「閲覧中」が 45秒以内に消える
   - (d) A がタブを閉じる → B 画面で即消える（`visibilitychange=hidden` / `beforeunload` 契機。消えない場合も 45秒で消える）
   - (e) 3人以上「○○ 他N名が閲覧中」形式
   - (f) ローカルモード（`createdBy` なし）では表示されない
   - (g) ユーザー名に `.` を含めて参加（例: `t.yamada`）→ 他画面で正しく表示・消去されることを確認（`FieldPath` 使用の検証）
3. **非干渉チェック**
   - DevTools > React Profiler で、他ユーザーのハートビート受信時に MainPage の players/courts が再レンダーされないことを確認
   - Network タブで presence 書き込みが `updatedAt` を含まないことを確認
4. **永続化チェック**
   - DevTools > Application > LocalStorage の `badminton-session` に presence が含まれていないことを確認
5. **TTL非干渉チェック**
   - presence 書き込みのみが続いても `sessions/{id}.updatedAt` が更新されないこと（TTL 30日のカウントが継続すること）を Firestore コンソールで確認
6. **コミット**: ブランチ `claude/prevent-duplicate-operations-NUZjt` にコミット → push

## 非対象（今回やらないこと）

- タップ対象（どのコート・選手）までのトラッキング ＝ 将来拡張
- ScoreInputPage / AccountingPage など他画面での表示 ＝ スコープ外（ユーザーが MainPage のみと回答）
- 実際の操作ロック ＝ ポリシー上やらない
- HistoryPage 等読み取り専用画面 ＝ 不要
- サーバーサイドでの自動プルーニング（Cloud Functions 等）＝ 現状無料運用のためクライアント側1回プルーニングで代替

## 既知のトレードオフ・限界

- **ScoreInputPage 遷移中は "離席" 扱い**: MainPage から ScoreInputPage に遷移した瞬間に MainPage が unmount され、クリーンアップで presence が消える。他ユーザーからは「誰もいない」ように見えるが、実際にはスコア入力中。MainPage のみをスコープとした結果のトレードオフ。
- **タブ強制終了時のエントリ残留**: `beforeunload` の async 書き込みは保証されないため、Firestore 側にエントリが残る可能性。UI は 45秒フィルタで対応、残留エントリはステップ6 の初回プルーニングで他ユーザーが掃除。
- **同一ユーザー複数タブ**: 同じ `currentUser` で2タブ開くと相互に上書き。最後の書き込み勝ちで機能的に問題なし。
