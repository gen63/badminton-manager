# 会計入力のセッション保存（Firebase 同期）

## Context

会計ページ（`/accounting`）の入力値は現在、`accountingStore.lastInput`（Zustand persist 単一キー `accounting-storage`）に保存されており、**セッション ID で区切られていない**。

結果として：

1. セッション A で入力 → セッション B に切替 → A に戻ると **B の値が残る**（A の入力は上書きされて消える）
2. 端末間でも共有されないため、別管理者/別端末からは最新の入力が見えない

既存の設計メモ（`docs/plans/2026-04-13-fix-sync-across-pages.md:39-42`）では「各デバイスで異なる入力があり得るため accountingStore は localStorage のみ」としていたが、運用実態は「**会計は管理者のみが入力**」「**1 セッションに複数の入力パターンを持たせる需要はない**」であり、この前提は誤り。

本修正で、会計入力を「セッションに紐づく情報」として Firestore に同期する。

## 設計方針

`sessionStore.updateInformation()`（`src/stores/sessionStore.ts:94-143`）がちょうど同じ型のパターン（ローカル即時反映＋Firestore 書き込み、ローカルモード判定付き）として存在するので、これを踏襲する。

- `Session.accounting?: LastInput` を型に追加し、Firestore セッションドキュメントの 1 フィールドとして持たせる
- `useSessionStore` に `updateAccounting(patch: Partial<LastInput>)` を追加
- `AccountingPage` は初期値・書き込みともに `session.accounting` を介する
- Firestore 書き込みは **500ms デバウンス**（onChange の連打でも write 1 回に集約）
- `accountingStore.records`（アップロード済み履歴）は **今回スコープ外**、localStorage のまま
- 既存の `isAdmin()` 権限制御（`AccountingPage.tsx:25`）はそのまま流用
- リモート更新の反映は既存の `useRealtimeSession` / `subscribeToSession` の onSnapshot に乗るため追加実装不要

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/types/session.ts` | `AccountingInput` 型（旧 `LastInput`）を定義し、`Session` に `accounting?: AccountingInput` を追加 |
| `src/stores/sessionStore.ts` | `updateAccounting(patch)` メソッドを追加（`updateInformation` と同じ構造：ローカル set →`session.createdBy` あれば dynamic import で `updateSession` 呼び出し）。`SessionState` interface にもシグネチャ追加 |
| `src/pages/AccountingPage.tsx` | 初期化 useEffect で `lastInput` 参照を `session.accounting` に置換。`saveAllInputs()` の書き込み先を `saveLastInput` から `updateAccounting` に変更。500ms の write デバウンスを追加（`useRef` + `setTimeout`/`clearTimeout`、アンマウント時 flush） |
| `src/stores/accountingStore.ts` | `lastInput`・`saveLastInput` を削除（`records`・`addRecord`・`removeRecord`・`clearRecords` は維持） |

## 再利用する既存関数

- `updateSession(sessionId, patch)` — `src/services/sessionService.ts:191-211`。部分更新が効くのでそのまま流用
- `useSessionStore().isAdmin()` — `src/stores/sessionStore.ts:78-87`。既に `AccountingPage` で参照済み
- `useRealtimeSession` / `subscribeToSession` — セッション全体が onSnapshot で同期されるため `accounting` フィールドも自動で追従
- `updateInformation` — `src/stores/sessionStore.ts:94-143` を `updateAccounting` のテンプレートに

## 移行・互換性

- 旧 `accounting-storage.lastInput`（localStorage）は廃止。残存データは読まれなくなるだけで害はない
- 新規セッションは `session.accounting` 未設定 → AccountingPage は従来通り試合履歴・過去 records から初期値を自動算出（フォールバックロジックは温存）
- オフライン時：Firestore 永続化が効くため、ローカル反映は即時・送信はオンライン復帰時（既存 `updateInformation` と同挙動）

## スコープ外（明示）

- `accountingStore.records`（過去の会計アップロード履歴）は端末ローカルのまま
- 2 人の管理者が同時編集した場合は last-write-wins（現実的にほぼ発生しない想定。必要なら別 PR で対処）
- 編集中にリモート更新が来てフォームの useState を上書きする仕組みは **入れない**（現状通り初回 mount で初期化のみ）

## 検証

**コミット前チェック（CLAUDE.md 必須）:**

```bash
npm run build
npm run lint
npm run test:run
```

**手動テスト:**

1. 共有セッション A で会計入力（男4 女2 免2、その他 "ツムラ" 400 など）
2. BottomNav でメインタブに切替 → 会計に戻る → 値が残っていること
3. セッション切替 UI でセッション B に移動 → B は空 or B 独自の値
4. セッション A に戻る → A の入力値が完全に復元されていること
5. 別ブラウザ（管理者 B）で同じセッションを開く → A が入力した値が見えること
6. オフライン化（DevTools Offline）して入力 → オンライン復帰後に Firestore に反映されていること
