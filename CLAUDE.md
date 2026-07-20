# CLAUDE.md

## 運用体制（常時適用）

- **Fable（claude-fable-5）は実作業を行わず、指揮に徹する**:
  コードの実装・修正・テスト作成などの実作業はサブエージェントに委任し、
  Fable 自身は調査の指示、設計・plan の作成、レビュー、受け入れ確認、
  コミット/push の管理に専念する。

## 開発ワークフロー

- 新機能・大きな変更の前に**必ず `plan` モードで計画**してから実装する
- 作成したplanは `docs/plans/YYYY-MM-DD-<機能名>.md` にコミットする
- コードベース探索前に `docs/plans/` の過去の設計意図を確認する

## コミット前チェック（必須）

以下を順番に実行し、すべて通ってからmasterにpush:

```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

## 参照ドキュメント

- **DESIGN.md** - UIデザインガイドライン（デザイン変更時に必ず参照）
- **README.md** - プロジェクト概要、技術スタック
- **docs/deployment.md** - 本番反映（デプロイ）手順。master への PR マージで
  GitHub Actions が GitHub Pages に自動デプロイする

## 同期アーキテクチャ（2026-05 Phase 1-5 リファクタ後）

- **真実のソースは Firestore document `sessions/{id}`**
  - 書き込み: `src/services/sessionMutations.ts` の各関数（全て `runTransaction`
    で `read → compute → write`）。`src/hooks/useSessionWriter.ts` 経由で UI から呼ぶ。
  - 読み取り: `src/hooks/useFirebaseSync.ts` が `onSnapshot` を購読し、ローカル
    zustand ストアに直接 `setState` する（merge 無し）。
- **zustand persist は最小限**（ローカル保持を限りなく減らす方針）
  - 撤廃済み (Phase 3): `playerStore` / `gameStore` / `reservationStore`
  - **`settingsStore`** は端末ローカル設定だけ persist (Phase A / 2026-05-06):
    - persist する: `gasWebAppUrl` / `accountingWebAppUrl` /
      `useStayDurationPriority` / `prioritizeDiversity`
    - persist しない: `practiceType` / `continuousMatchMode` / `recordScores`
      (Firestore 同期対象)
  - **`sessionStore`** は `currentUser` のみ persist (Phase B / 2026-05-06):
    - `session` 自体は持たない。リロード時は SessionSelectPage に戻り、
      ユーザーがセッションを選び直す。`currentUser` で SessionJoinPage の
      名前選択を自動化。
  - **`accountingStore`** は persist しない (Phase C / 2026-05-06):
    - `records[]` は GAS シートが永続先。AccountingPage の「直近レコードから
      自動入力」は撤廃済み（標準値フォールバックのみ）。
  - 真実のソースは Firestore のみ。マウント時はストア空 → 初回 onSnapshot で反映。
  - `useSyncStatusStore.isGameStateLoaded` で初回受信完了を追跡。
  - 詳細: `docs/plans/2026-05-06-settings-persist-narrowing.md` /
    `docs/plans/2026-05-06-local-storage-minimization.md`
- **Firebase は必須**（Phase 4）
  - `.env` に `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_PROJECT_ID` 等が必要。
  - `src/lib/firestoreUtils.ts` の `requireDb()` で未設定時に明示エラー。
- **オフライン書き込みはブロック**
  - Firestore SDK の IndexedDB cache で読みは可だが、書き込みは透過的に待機。
- **設計詳細**: `docs/plans/2026-05-03-firestore-as-source-of-truth.md`

## 信頼モデル / セキュリティ（重要）

本アプリは「**小規模・知人グループが共有する** バドミントン練習管理ツール」前提
で設計されている。以下のセキュリティ制限を理解した上で運用すること。

- **認証なし**: Firebase Auth は未使用。`currentUser` は localStorage に保存される
  単なる名前文字列。攻撃者が `localStorage` を編集すれば任意の名前を名乗れる。
- **権限チェックは全クライアント側**: `isAdmin()` / `isCreator()` は名前比較のみ。
  サーバーサイド検証なし。
- **セッション ID は 6 文字英数字**: 36^6 ≈ 22 億通り。総当たりは現実的でないが、
  URL を漏らせば誰でも参加できる。
- **Firestore Security Rules**: リポジトリには含まれない（Firebase console 管理）。
  練習グループ外には URL を共有しないこと。
- **本格的なマルチテナント運用は想定していない**: 全データが「セッション ID
  を知る人」全員に公開される。個人情報や機微なデータは入力しないこと。

将来的に Anonymous Auth + UID ベース権限 + リポジトリ管理の rules に
移行する場合は別 plan で対応する（`docs/plans/<future>-firebase-auth.md`）。
