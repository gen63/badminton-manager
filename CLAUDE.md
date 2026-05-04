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
  - `settingsStore` のみ persist 維持（端末ローカル設定が混在しているため）。
- **Firebase は必須**（Phase 4）
  - `.env` に `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_PROJECT_ID` 等が必要。
  - `src/lib/firestoreUtils.ts` の `requireDb()` で未設定時に明示エラー。
- **オフライン書き込みはブロック**
  - Firestore SDK の IndexedDB cache で読みは可だが、書き込みは透過的に待機。
- **設計詳細**: `docs/plans/2026-05-03-firestore-as-source-of-truth.md`
