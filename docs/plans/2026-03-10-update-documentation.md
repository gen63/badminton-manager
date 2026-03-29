# ドキュメント全般更新プラン

## Context
実装が進む一方で、ドキュメントの更新が追いついていない。主要ドキュメント（README.md 等）と実装の間に多くの乖離がある。また、doc/ 配下の初期設計仕様書は古くなり過ぎて誤解を招く可能性があり、ルート直下に開発ノート（SYNC_*.md）が散在している。最新の実装状態に合わせてドキュメントを整理・更新する。

---

## 1. README.md の更新

### 1-1. 主な機能セクション — 新機能の追記
以下の実装済み機能がドキュメントに記載されていない：

- **オンラインモード（Firebase）** — セッション共有（6文字ID）、QRコード表示、リアルタイム同期
- **シングルスモード** — セッション作成時にダブルス/シングルスを選択可能
- **予約機能** — 1〜4人でコート予約キュー（FIFO順）
- **会計機能** — 収支管理、参加費・シャトル費用の記録（AccountingPage）
- **お知らせ機能** — 管理者アナウンス + 既読管理
- **Undo/Redo** — 操作取り消し・やり直し
- **ボトムナビゲーション** — 予約・プレイヤー・会計・履歴の4タブ
- **連続モード** — コート自動配置＋自動開始
- **コート配置ブロック** — 低流量時にコート配置を制限（ローテーション促進）

### 1-2. Phase ステータス更新
- Phase 1: Firebase同期・セッション共有・リアルタイム同期は **実装済み** → ✅ に更新
- Phase 1 のオプション（セッション自動削除、FCM通知）は未実装のまま
- Phase 1.5, Phase 2 は未着手のまま
- 開発状況テキスト（末尾）も更新

### 1-3. テスト数の更新
- 「86テスト」→ 実際のテスト数に更新
- テストファイル一覧に `src/stores/sessionStore.test.ts` を追加
- テストファイルごとのケース数を実態に合わせる

### 1-4. プロジェクト構造の更新
現在のディレクトリツリーと大幅に乖離。実際のファイル構成に合わせて全面更新：

**components/ — 実際のファイル:**
BottomNav.tsx, CourtCard.tsx, CourtTimer.tsx, EmptyState.tsx, LoadingSpinner.tsx, PWAPrompt.tsx, PaymentModal.tsx, PlayerSwapModal.tsx, ReservationAddModal.tsx, ReservationModal.tsx, SessionURLDisplay.tsx, Toast.tsx, WinnerSelectModal.tsx

**pages/ — 実際のファイル:**
AccountingPage.tsx, HistoryPage.tsx, MainPage.tsx, PlayerSelect.tsx, ReservationPage.tsx, ScoreInputPage.tsx, SessionCreate.tsx, SessionJoinPage.tsx, SettingsPage.tsx

**stores/ — 実際のファイル:**
accountingStore.ts, gameStore.ts, playerStore.ts, reservationStore.ts, sessionStore.ts, settingsStore.ts, undoStore.ts

**hooks/ — 実際のファイル:**
useFirebaseSync.ts, useGameTimer.ts, useRealtimeSession.ts, useToast.ts

**types/ — 実際のファイル:**
accounting.ts, court.ts, match.ts, player.ts, reservation.ts, session.ts, undo.ts

**services/ — 新ディレクトリ:**
sessionService.ts

**lib/ — 追加ファイル:**
firebase.ts, sheetsApi.ts, sheetsMembers.ts, errorHandler.ts

### 1-5. 技術スタック更新
- Firebase（Firestore リアルタイム同期）を追加
- qrcode.react（QRコード生成）を追加
- lucide-react（アイコン）を追加

### 1-6. 最終更新日
2026-03-03 → 2026-03-10

---

## 2. README_TESTS.md の更新

### 2-1. テストファイル一覧の更新
- `src/stores/sessionStore.test.ts`（お知らせ機能テスト）を追加
- 各テストファイルのケース数を実態に合わせる

### 2-2. E2Eテストセクション修正
「E2Eテスト（今後）」セクションに未実装チェックリストが残っている（`- [ ] 2つのブラウザで同時操作` 等）。
E2Eテストは既に実装済み（`e2e/sync.spec.ts`, 5シナリオ）。
→ README_E2E.md への参照リンクに置き換え

### 2-3. CI/CDセクション修正
「GitHub Actionsでのテスト自動化を検討中」→ GitHub Actions で自動ビルド＆デプロイ済み

---

## 3. PROJECT.md の更新

### 3-1. ディレクトリ構造の更新
現在の構造に反映：
- `services/` ディレクトリの追加
- `e2e/` ディレクトリの追加
- `doc/` に「（アーカイブ：初期設計仕様書）」注記追加
- テストファイル（`*.test.ts`）の記載追加

---

## 4. doc/ 配下 — アーカイブ化

### 理由
- doc/ は2026年1月の初期設計時の仕様書（01_overview.md〜06, FINAL_SPEC_SUMMARY.md 等）
- **技術スタックの乖離**: React 18→19、React Router v6→v7、react-hot-toast・date-fns・googleapis 等の未使用ライブラリが記載
- **冗長な重複ドキュメント**:
  - `badminton_screen_design.md` と `05_screen_design.md`（画面設計が2つ）
  - `badminton_game_management_requirements.md` と `02_functional_requirements.md`（要件定義が2つ）
- **CHANGELOG.md** は 2026-01-30 で止まっており5週間以上更新なし
- **FINAL_SPEC_SUMMARY.md**: Phase 1 は全て 🔲 だが多くは実装済み、デプロイ先も「Vercel」と書かれているが実際は GitHub Pages
- **04_technical_spec.md**: package.json 例、型定義例、ディレクトリ構造が全て古い。React Context の例が載っているが実際は Zustand
- **issues/001_singles_support.md**: シングルスモードの詳細設計だが、既に実装完了済み。多数のチェック項目が未チェックのまま残存
- 実装はもはやこの仕様書に基づいておらず、誤解を招く
- 歴史的価値はあるため削除ではなくアーカイブ扱い

### 作業
- `doc/README.md` の冒頭に **アーカイブ注意書き** を追加
  - 「⚠️ このディレクトリは初期設計時（2026年1月）の仕様書です。現在の実装とは大きく乖離しています。最新情報は README.md, PROJECT.md, DESIGN.md を参照してください。」

---

## 5. SYNC_*.md — docs/plans/ へ移動

### 対象ファイル
- `SYNC_FIX_PLAN.md` → `docs/plans/2026-02-sync-fix-plan.md`
- `SYNC_REVIEW_COMPLETE.md` → `docs/plans/2026-02-sync-review-complete.md`
- `SYNC_REVIEW_ROUND3.md` → `docs/plans/2026-02-sync-review-round3.md`

### 理由
- Firebase同期修正の開発ノート（問題1〜13の発見・修正記録）
- 修正は全て完了済み
- プロジェクトルートを散らかしている
- docs/plans/ に移動し、他の開発計画書と統一

---

## 6. README_E2E.md — 軽微な更新

### 確認結果
内容は概ね正確。以下のみ更新：
- 特に更新不要（内容は実装と一致している）

---

## 7. DESIGN.md — 更新不要

### 確認結果
最終更新 2026-03-08 で最新。内容に乖離なし。

---

## 8. CLAUDE.md — 更新不要

### 確認結果
ワークフロー指示は正確。参照先ファイルも正しい。

---

## 対象ファイル一覧

| ファイル | 作業内容 |
|---------|---------|
| `README.md` | 新機能9個追記、Phase更新、テスト数更新、プロジェクト構造全面更新、技術スタック更新 |
| `README_TESTS.md` | テストファイル追加、E2Eセクション修正、CI/CDセクション修正 |
| `PROJECT.md` | ディレクトリ構造更新 |
| `doc/README.md` | アーカイブ注意書き追加 |
| `SYNC_FIX_PLAN.md` | docs/plans/ へ移動（git mv） |
| `SYNC_REVIEW_COMPLETE.md` | docs/plans/ へ移動（git mv） |
| `SYNC_REVIEW_ROUND3.md` | docs/plans/ へ移動（git mv） |

**変更しないファイル:** DESIGN.md, CLAUDE.md, README_E2E.md, docs/plans/*.md

## 検証方法
- `npm run build` — ビルド確認（ドキュメント変更のみなのでエラーなし想定）
- `npm run lint` — lint確認
- 各ドキュメントの記載内容と実際のファイル構成の照合
