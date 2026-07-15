# 支払い一覧に「誰が支払い操作をしたか」を表示する

## Context

支払い一覧画面（`AccountingPage.tsx` の「支払い一覧」タブ）では現在、各プレイヤーの
支払い登録時刻（🕐 HH:MM）のみが表示されている。運用上、複数の管理者が並行して
支払い登録操作を行うため、「いつ」に加えて「誰が（どの操作者が）登録したか」も
一覧上で確認できるようにしたい。

本アプリはアカウントレスで、`currentUser`（`sessionStore` に保存される単なる名前
文字列）が「今この端末を操作している人」を表す唯一の識別子（信頼モデルは
CLAUDE.md 記載の通りクライアント側のみ・検証なし）。この `currentUser` を
「支払い操作を実行した人」として記録する。

## 既存の関連実装（踏襲するパターン）

- `Player` 型: `src/types/player.ts` — `paymentTimestamp?: number` が支払い登録時刻。
- 支払い登録/修正: `computeApplyPayment`（`src/services/sessionMutations.ts:282`）
  - `paymentTimestamp` は **未払い→支払いへの遷移時のみ** 更新し、金額修正時は保持
    （2026-07-09 の fix-payment-amount-correction plan 参照）。
- 支払い取消（誤登録を未登録に戻す単純トグル）:
  `computeToggleOperationStatus`（`src/services/sessionMutations.ts:251`）
  - `field === 'payment' && newValue`（OFF→ON）の時だけ `paymentTimestamp` を更新。
    OFF にする方向（revert）では触らない。
- ラッパー関数: `toggleOperationStatus` / `applyPayment`
  （`src/services/sessionMutations.ts:833,841`）→ `useSessionWriter.ts` の
  同名フック → `MainPage.tsx` / `PlayerSelect.tsx` から
  `writer.applyPayment(playerId, amount)` / `writer.toggleOperationStatus(playerId, 'payment')`
  として呼ばれる。
- `currentUser` の他の利用例（null 許容パターン）: `sessionStore.ts` の
  `updateInformation` で `...(currentUser ? { updatedBy: currentUser } : {})`
  — 操作者未選択（`currentUser === null`、裏管理ケース）の場合はフィールドを
  差し込まない。
- 表示箇所: `AccountingPage.tsx:606-644`（支払い詳細リスト）、
  `paymentStats` の `useMemo`（`AccountingPage.tsx:249-270`）で表示用データを整形。

## 実装方針

### 1. 型定義: `src/types/player.ts`
`paymentTimestamp` と対になる新フィールドを追加:
```ts
paymentOperatorName?: string; // 支払い操作を実行した人（currentUser、未選択時は undefined）
```

### 2. `src/services/sessionMutations.ts`
- `computeApplyPayment(state, playerId, amount, now, operatorName?)`:
  `!wasPaid` の分岐で `paymentTimestamp` と同時に
  `updates.paymentOperatorName = operatorName` をセット（`operatorName` が
  undefined の場合はフィールドを立てない＝ `...(operatorName ? { paymentOperatorName: operatorName } : {})`）。
  金額修正時（`wasPaid === true`）は timestamp 同様に既存値を保持。
- `computeToggleOperationStatus(state, playerId, field, now, operatorName?)`:
  `field === 'payment' && newValue` の分岐で同様に `paymentOperatorName` をセット。
  revert 方向（OFF）は既存の `paymentTimestamp` 挙動に合わせて触らない。
- エクスポート関数 `applyPayment` / `toggleOperationStatus`
  （`sessionMutations.ts:833,841`）に `operatorName?: string` 引数を追加し、
  compute 関数へ受け渡す。

### 3. `src/hooks/useSessionWriter.ts`
- `useSessionStore((s) => s.currentUser)` を取得（`sessionId` と同様に既に
  インポート済みの `useSessionStore` から）。
- `applyPayment` / `toggleOperationStatus` の呼び出し内部で
  `sm.applyPayment(sid, id, amount, undefined, currentUser ?? undefined)` /
  `sm.toggleOperationStatus(sid, id, field, undefined, currentUser ?? undefined)`
  のように自動的に注入する。**呼び出し側（`MainPage.tsx` / `PlayerSelect.tsx`）の
  シグネチャは変更しない**（既存の `writer.applyPayment(playerId, amount)` の
  ままで動く）。`now` 引数はデフォルト値 `Date.now()` に任せるため呼び出し時は
  省略できるよう、`sm.applyPayment` の `now` パラメータ位置を維持しつつ
  `operatorName` は末尾に追加する（既存呼び出し箇所や `sessionMutations.test.ts`
  との後方互換のため、新引数は末尾追加とする）。

### 4. `src/pages/AccountingPage.tsx`
- `paymentStats` の `useMemo`（249-270行目）の `players.map` に
  `paymentOperatorName: p.paymentOperatorName` を追加。
- 支払い詳細リスト（614-641行目）で、既存の🕐時刻表示の隣に操作者名を表示する。
  例: `🕐 14:32 · 太郎` のように時刻の後ろに `・{name}` 形式で追加
  （新規アイコンは使わず、同じ `text-[10px]` の span 内に収める）。
  `paymentOperatorName` が無い場合（過去データ・裏管理操作）は何も表示しない。

### 5. テスト: `src/services/sessionMutations.test.ts`
- `computeApplyPayment` / `computeToggleOperationStatus` の既存テストに準じて
  `operatorName` を渡した場合に `paymentOperatorName` がセットされること、
  金額修正時・revert 時に既存値が保持/変更されないことを確認するケースを追加。

## 変更対象ファイル

- `src/types/player.ts`
- `src/services/sessionMutations.ts`
- `src/services/sessionMutations.test.ts`
- `src/hooks/useSessionWriter.ts`
- `src/pages/AccountingPage.tsx`
- `docs/plans/2026-07-15-payment-operator-visibility.md`（本plan doc をコミット）

## 検証

- `npm run build && npm run lint && npm run test:run`（CLAUDE.md 必須チェック）。
- 手動確認は困難（Firestore 必須構成のため dev server 起動のみでは実データ確認不可）
  だが、`sessionMutations.test.ts` に振る舞いを網羅するテストケースを追加することで
  ロジックの正しさを担保する。
