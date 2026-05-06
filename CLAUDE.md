# CLAUDE.md

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

## 同期アーキテクチャ（2026-05 Phase 1-5 リファクタ後）

- **真実のソースは Firestore document `sessions/{id}`**
  - 書き込み: `src/services/sessionMutations.ts` の各関数（全て `runTransaction`
    で `read → compute → write`）。`src/hooks/useSessionWriter.ts` 経由で UI から呼ぶ。
  - 読み取り: `src/hooks/useFirebaseSync.ts` が `onSnapshot` を購読し、ローカル
    zustand ストアに直接 `setState` する（merge 無し）。
- **zustand persist は使わない**（playerStore / gameStore / reservationStore）
  - 真実のソースは Firestore のみ。マウント時はストア空 → 初回 onSnapshot で反映。
  - `useSyncStatusStore.isGameStateLoaded` で初回受信完了を追跡。
- **`settingsStore` は端末ローカル設定だけ persist**（Phase A / 2026-05-06）
  - persist する: `gasWebAppUrl` / `accountingWebAppUrl` /
    `useStayDurationPriority` / `prioritizeDiversity`（端末固有・Firestore に
    無い）。
  - persist しない: `practiceType` / `continuousMatchMode` / `recordScores`
    （Firestore 同期対象。前セッションから drift して別セッションを汚すのを
    防ぐ）。version 1 の migrate で旧 localStorage の同期対象を剥がす。
  - 詳細: `docs/plans/2026-05-06-settings-persist-narrowing.md`
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
