# CLAUDE.md

このファイルは毎セッション読み込まれるため簡潔に保つ。詳細は各 plan/doc を参照。

## 運用体制
- **Fable（claude-fable-5）は実作業をせず指揮に徹する**: 実装・修正・テスト作成は
  サブエージェントに委任し、Fable は調査指示・plan 作成・レビュー・受け入れ・
  commit/push 管理に専念する。

## 開発ワークフロー
- 新機能・大きな変更は**必ず `plan` モードで計画**してから実装
- plan は `docs/plans/YYYY-MM-DD-<機能名>.md` にコミットし、`docs/plans/INDEX.md`
  にも1行追記する
- 過去の設計意図は **`docs/plans/INDEX.md`（1行索引）で該当 plan を探し、その1件だけ**
  読む。`docs/plans/` の全件通読はしない

## コミット前チェック（必須）
master へ push する前に順に実行し、すべて通す:
```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

## 参照ドキュメント（必要時のみ読む）
- **DESIGN.md** — UI デザインガイドライン（デザイン変更時）
- **README.md** — プロジェクト概要・技術スタック
- **docs/deployment.md** — デプロイ手順（master への PR マージで GitHub Actions が
  GitHub Pages へ自動デプロイ）

## 同期アーキテクチャ
真実のソースは **Firestore document `sessions/{id}`** のみ。ローカル保持は最小化。
- **書き込み**: `src/services/sessionMutations.ts`（全関数 `runTransaction` で
  read→compute→write）。UI からは `src/hooks/useSessionWriter.ts` 経由。
- **読み取り**: `src/hooks/useFirebaseSync.ts` が `onSnapshot` を購読し zustand へ
  `setState`（merge 無し）。初回受信は `useSyncStatusStore.isGameStateLoaded` で追跡。
- **zustand persist は最小限**:
  - `settingsStore`: 端末ローカル設定のみ persist（`gasWebAppUrl` /
    `accountingWebAppUrl` / `useStayDurationPriority` / `prioritizeDiversity`）。
    `practiceType` / `continuousMatchMode` / `recordScores` は Firestore 同期で持たない。
  - `sessionStore`: `currentUser` のみ。`session` は持たず、リロード時は再選択。
  - `accountingStore`: persist しない（永続先は GAS シート）。
  - `playerStore` / `gameStore` / `reservationStore` は persist 撤廃済み。
- **Firebase 必須**: `.env` に `VITE_FIREBASE_*` が必要。未設定は
  `src/lib/firestoreUtils.ts` の `requireDb()` が明示エラー。オフライン書き込みはブロック。
- 詳細: `docs/plans/2026-05-03-firestore-as-source-of-truth.md` /
  `2026-05-06-local-storage-minimization.md` / `2026-05-06-settings-persist-narrowing.md`

## 信頼モデル / セキュリティ
「小規模・知人グループ共有」前提。サーバー側検証は一切ない。
- **認証なし**: `currentUser` は localStorage の名前文字列にすぎない（改変で詐称可）。
- **権限チェックは全クライアント側**: `isAdmin()` / `isCreator()` は名前比較のみ。
- セッション ID は 6 文字英数字。URL を漏らせば誰でも参加できる。
- **Firestore Security Rules はリポジトリ外**（Firebase console 管理）。
- 個人情報・機微データは入力しない。本格的なマルチテナント運用は非対象。
- 将来 Anonymous Auth + UID 権限へ移行する場合は別 plan で対応。
