# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

バドミントン練習を管理する React 19 + TypeScript + Vite の PWA。
Firestore リアルタイム同期で複数デバイス共有、6 文字セッション ID + QR で参加。
GitHub Pages (`/badminton-manager/` basename) にデプロイ。

技術スタック: React 19 / TypeScript / Vite / Tailwind CSS 4 / Zustand /
React Router v7 / Firebase Firestore / Vitest / Playwright。

## 開発ワークフロー

- 新機能・大きな変更の前に **必ず `plan` モードで計画** してから実装する
- 作成した plan は `docs/plans/YYYY-MM-DD-<機能名>.md` にコミットする
- コードベース探索前に `docs/plans/` の過去の設計意図を確認する
  （特に `2026-05-03-firestore-as-source-of-truth.md` と
  `2026-05-06-local-storage-minimization.md` は同期/状態管理の現状理解に必須）

## コマンド

```bash
npm run dev          # vite dev server (http://localhost:5173/badminton-manager/)
npm run build        # tsc -b（型チェック） + vite build
npm run lint         # eslint .
npm run test         # vitest watch
npm run test:run     # vitest 1 回実行（CI 用）
npm run test:ui      # vitest UI
npm run test:coverage
npm run test:e2e     # playwright（同期関連を変えたら手動実行）
npm run preview      # ビルド成果物プレビュー
```

単一テストファイルを走らせる: `npm test -- syncUtils.test.ts`
（vitest はファイル名部分一致でフィルタする）。

E2E 初回セットアップ: `npx playwright install chromium`。

### コミット前チェック（必須・順序を守る）

```bash
npm run build    # 型チェック + ビルド
npm run lint     # コードスタイル
npm run test:run # ユニットテスト
```

すべて通ってから push する。`master` への push で GitHub Actions が
自動デプロイ（`.github/workflows/deploy.yml`）。バージョン番号は
`git rev-list --count HEAD` から自動採番。

## 必要な環境変数

Firebase は **必須**（Phase 4 以降ローカルモード廃止）。`.env` に:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_DISCORD_WEBHOOK_URL=  # 任意（バグレポート送信先）
```

未設定時は `src/lib/firestoreUtils.ts:requireDb()` が `SessionError('firebase-not-configured')` を投げる。

## 同期アーキテクチャ（2026-05 Phase 1-7 リファクタ後）

**真実のソースは Firestore document `sessions/{id}` のみ。**
ローカルモード・3-way merge・`lastSyncedState`・`pushBlockMs` 等の
旧同期機構は撤去済み。

### 書き込み（write path）

UI → `useSessionWriter` フック → `services/sessionMutations.ts` の関数
→ `runTransaction(read → compute → write)` → Firestore。

- `sessionMutations.ts` の各関数は `mutateGameState(sessionId, apply)` という
  汎用ラッパーを使う。`apply(remoteState)` は次の `GameState` を返す純粋関数。
- Firestore は内部で最大 5 回自動リトライするので **`apply` は idempotent** に
  書く。UUID や `Date.now()` はラッパーのクロージャで 1 度だけ生成して `apply`
  に渡すこと。
- `aborted` は `SessionError('conflict')` に変換される。
- 書き込み前に `sanitize()` で `undefined` を除去する（Firestore は受け付けない）。
- `useSessionWriter` 内で楽観的に setState **しない**。onSnapshot がストアを
  更新するため。

### 読み取り（read path）

`hooks/useFirebaseSync.ts` が `onSnapshot(doc(db, 'sessions', sessionId))` を
購読し、受信したら **merge せずに直接** zustand ストアに `setState` する。
初回受信完了は `useSyncStatusStore.isGameStateLoaded` で追跡。
`<FirebaseSyncMount>` コンポーネントが `App.tsx` のルートでこの hook を起動する。

### zustand persist は最小限

- 撤廃済み: `playerStore` / `gameStore` / `reservationStore` の persist
- `settingsStore`: 端末ローカル設定だけ persist
  （`gasWebAppUrl` / `accountingWebAppUrl` / `useStayDurationPriority` /
  `prioritizeDiversity`）。Firestore 同期対象（`practiceType` /
  `continuousMatchMode` / `recordScores`）は persist しない
- `sessionStore`: `currentUser`（名前文字列）のみ persist。`session` 自体は
  持たない。リロード時は `SessionSelectPage` に戻る
- `accountingStore`: persist しない（GAS シートが永続先）

マウント時はストア空 → 初回 onSnapshot で反映、という前提でコードを書くこと。

### オフライン挙動

Firestore SDK の IndexedDB cache で **読みは可**、書きは復帰まで透過的に待機。

## ディレクトリ構成（要点のみ）

```
src/
├── App.tsx                # BrowserRouter（basename=/badminton-manager）+ ルート別 lazy
├── pages/                 # ルート単位の画面（SessionSelect / Main / History / 等）
├── components/            # 共通 UI（CourtCard, BottomNav, *Modal, Toast 等）
├── hooks/
│   ├── useFirebaseSync.ts   # onSnapshot 購読 → store setState
│   ├── useSessionWriter.ts  # UI → sessionMutations の唯一の入口
│   ├── useGuardedAction.ts  # 権限/状態ガード
│   ├── usePresence.ts       # 在席表示
│   └── useGameTimer.ts
├── services/
│   ├── sessionService.ts    # GameState 型定義 / セッション CRUD
│   └── sessionMutations.ts  # 全 write を runTransaction で実装
├── stores/                # zustand store（上記 persist ルールを守る）
├── lib/
│   ├── algorithm.ts         # 配置アルゴリズム（純粋関数 / 単体テスト多数）
│   ├── firebase.ts          # Firebase 初期化
│   ├── firestoreUtils.ts    # requireDb / sanitize / timestampToMillis
│   ├── gameOperations.ts    # finishMatch 等の純粋 compute
│   ├── sessionArchive.ts    # 表示可否 / firstMatchStartedAt 計算
│   ├── inputValidation.ts   # 入力サニタイズ
│   └── sheets{Api,Members}.ts  # GAS Web App 連携
├── types/                 # player / court / match / session / reservation / accounting
└── test/                  # vitest セットアップ
e2e/                       # Playwright（同期 5 シナリオ、手動実行）
docs/plans/                # 設計ドキュメント（変更前にここを読む）
scripts/auto-create-session.ts  # `npm run auto-session` 用スクリプト（lint 対象外）
```

## 参照ドキュメント

- **DESIGN.md** — UI デザインガイドライン（カードベース UI、8pt グリッド、
  elevation システム）。デザイン変更時に必ず参照
- **README.md** — 機能一覧、配置アルゴリズム v2 の確率表・優先度ルール、使い方
- **PROJECT.md** — デプロイ手順
- **README_TESTS.md / README_E2E.md** — テストの詳細

## 信頼モデル / セキュリティ（重要）

本アプリは「**小規模・知人グループが共有する** バドミントン練習管理ツール」前提
で設計されている。以下のセキュリティ制限を理解した上で運用すること。

- **認証なし**: Firebase Auth 未使用。`currentUser` は localStorage の名前文字列。
  攻撃者が `localStorage` を編集すれば任意の名前を名乗れる
- **権限チェックは全クライアント側**: `isAdmin()` / `isCreator()` は名前比較のみ。
  サーバーサイド検証なし
- **セッション ID は 6 文字英数字**: 36^6 ≈ 22 億通り。総当たりは現実的でないが、
  URL を漏らせば誰でも参加できる
- **Firestore Security Rules**: リポジトリには含まれない（Firebase console 管理）
- **本格的なマルチテナント運用は想定していない**: 個人情報や機微なデータは入力しない

将来 Anonymous Auth + UID ベース権限 + リポジトリ管理の rules に
移行する場合は別 plan で対応する（`docs/plans/<future>-firebase-auth.md`）。

## 規約・ハマりどころ

- **すべての write は `useSessionWriter` 経由**。`services/sessionService.ts` を
  UI から直接呼ばない（旧 API。`sessionMutations` 側に統一）
- **Firestore に書く前に `sanitize()`**。`undefined` フィールドが混じると失敗
- **`apply` 関数は idempotent**。トランザクション内で UUID/時刻を生成しない
- **store を merge せず setState**（読み取りパスの規約）
- **新機能は plan → docs/plans に commit → 実装** の順を守る
- ESLint: `dist`, `dev-dist`, `scripts` は除外（`scripts/auto-create-session.ts`
  は ESLint 対象外）
