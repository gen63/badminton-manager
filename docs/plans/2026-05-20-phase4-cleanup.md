# Phase 4 クリーンアップ: ローカルモード残骸の削除

日付: 2026-05-20
ブランチ: `claude/review-screen-navigation-y7aBd`
スコープ: B (中) — 死んだ条件分岐削除 + UI 分岐簡素化

## 背景

Phase 4 (`2026-05-03-firestore-as-source-of-truth.md`) で「Firebase 必須化 + ローカル
モード廃止」が完了したが、当時はリスク最小化のため defensive guard と互換コードを
残した。本 plan で残骸を削除し、不変条件を明確化する。

### 不変条件 (Phase 4 後)

- セッションが存在する (`session !== null`) ならば、`session.createdBy` は必ず truthy
  - `SessionCreate.tsx:158` で常に実名がセットされる
  - bot 作成セッション (`AUTO_SESSION_BOT_CREATOR` sentinel) も
    `sessionService.ts:228` の文字列でセット済み (transaction で初回 join 時に実名へ昇格)
- 旧バージョン (Phase 3 以前) の `createdBy` 無しセッションは存在しない
  - `legacyStorageMigration.ts` が version 0 → 1 で persisted state を破棄済み
- したがって `!session?.createdBy` は `!session` と等価 → 「ローカルモード」分岐は全て dead

## ゴール

1. `/local` ルートと唯一の呼び出し元 (`SessionSelectPage` の `<Navigate to="/local">`) を削除
2. `sessionStore` の `isCreator()` / `isAdmin()` から「`!createdBy` → 全員管理者」分岐を削除
3. `sessionStore` の Firestore 同期ガード `if (session.id && session.createdBy)` を
   `if (session.id)` に簡素化
4. UI コンポーネントの `!session?.createdBy || ...` / `session?.createdBy && ...` を
   `session` ベースに簡素化
5. stale な「ローカルモード」コメントを更新

## 非ゴール（別 PR に分離）

- `firebase.ts` の `db` を non-nullable 化する structural change (C スコープ)
- `isFirebaseConfigured()` の削除（FirebaseConfigBanner / useEffect 早期 return で
  まだ使用中。Firebase 未設定時の UX として価値あり）
- 古い plan ドキュメントの一括 supersede 注記
- `AUTO_SESSION_BOT_CREATOR` の扱い変更（外部スクリプトで使われ続けるため温存）

## 変更ファイル一覧

### 1. `src/App.tsx`
- L65: `<Route path="/local" element={<SessionCreate />} />` を削除

### 2. `src/pages/SessionSelectPage.tsx`
- L189-191: `if (!isFirebaseConfigured()) return <Navigate to="/local" replace />;` を削除
  - `useEffect` の `isFirebaseConfigured()` 早期 return (L157) は維持
  - 未設定時の表示は `FirebaseConfigBanner` が担当する (App level)
- L189 のコメント "Firebase未設定時はローカルモードにリダイレクト" を削除

### 3. `src/stores/sessionStore.ts`
- `isCreator()` (L73-82): `if (!session?.createdBy) return true;` (L75-76) を削除し、
  代わりに `if (!session || !currentUser) return false;` に整理
- `isAdmin()` (L83-92): `if (!session?.createdBy) return true;` (L85-86) を削除し、
  代わりに `if (!session) return false;` に整理 (dev mode 例外は維持)
- `updateConfig` (L52): `if (session?.id && session?.createdBy)` → `if (session?.id)`
- `updateInformation` (L113, L144): `if (session.id && session.createdBy)` → `if (session.id)`
- `markInformationAsRead` (L174): 同上
- `updateAccounting` (L216): 同上

### 4. `src/components/BottomNav.tsx`
- L40-41:
  ```ts
  // ローカルモード or 管理者: 全件表示
  if (!session?.createdBy || isAdmin()) {
  ```
  →
  ```ts
  // 管理者: 全件表示
  if (isAdmin()) {
  ```
- L80: `if (tab.id === 'reservation' && session?.createdBy && !isPWA && !isDev)`
  → `if (tab.id === 'reservation' && session && !isPWA && !isDev)`
  - BottomNav は session 有りページからのみ描画されるため `session` は実質常に truthy
    だが、リロード直後の一瞬等を考えて明示的に維持

### 5. `src/pages/MainPage.tsx`
- L151-158 useEffect: `if (!session?.createdBy) return; // ローカルモードでは不要`
  → `if (!session) return;` (コメント削除)
- L158 依存配列: `session?.createdBy` → `session`
- L606: `{session?.createdBy && (` → `{session && (`
  - JSX レンダー時は L261 の session ガードで session 非 null 保証だが、
    型システム上は `session?` のままなので明示維持
  - 「インフォメーションアイコン（オンラインモードのみ）」コメントは削除

### 6. `src/pages/HistoryPage.tsx`
- L231-232:
  ```ts
  // 自分の試合フィルタが使えるのはオンラインモード & currentUser がある時のみ
  const canFilterByMe = !!session?.createdBy && !!currentUser;
  ```
  →
  ```ts
  // 自分の試合フィルタは currentUser がある時のみ
  const canFilterByMe = !!session && !!currentUser;
  ```

### 7. `src/components/UnrecordedMatchPrompt.tsx`
- L51-53:
  ```ts
  const isOnlineMode = !!session?.createdBy;
  const canShow =
    recordScores && isOnlineMode && !!currentUser && isGameStateLoaded;
  ```
  →
  ```ts
  const canShow =
    recordScores && !!session && !!currentUser && isGameStateLoaded;
  ```
- L29 のコメント「動作前提: 試合記録モード (recordScores=true) かつオンラインモード。」
  から「かつオンラインモード」を削除（常にオンラインモード）

### 8. `src/pages/SessionJoinPage.tsx`
- L147 コメント「別セッションへの切替・新規入室・ローカルモードからの遷移時は
  従来通りクリアする。」から「・ローカルモードからの遷移」を削除

### 9. `src/stores/sessionStore.test.ts`
- L532-546 「ローカルモード（createdBy なし）では Firestore に送信しない」テストは
  もはや Phase 4 の不変条件 (createdBy 必須) と矛盾する仕様をテストしているため削除
- 代わりに新規テスト「session が null の状態では Firestore に送信しない」を追加し
  「セッション未選択時の write 防止」という現代的な不変条件を担保

## 検証

```bash
npm run build
npm run lint
npm run test:run
```

### 手動

1. 通常フロー: SessionSelect → Create → MainPage 動作確認
2. 既存セッションへの join 動作確認
3. 管理者 / 非管理者で BottomNav バッジ / 履歴フィルタ / 未記録試合プロンプトの
   表示動作が変わらないこと

## ロールバック

各変更は単独 commit にせず 1 commit に纏める（互いに依存するため）。問題が見つかった
場合は revert で一括戻す。

## 関連

- `docs/plans/2026-05-03-firestore-as-source-of-truth.md` - Phase 4 設計
- `docs/plans/2026-05-20-remove-playerselect-setup-mode.md` - 同日の PlayerSelect 整理
