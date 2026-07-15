# オート作成セッションの再実行時 E-ToMo 出欠同期

## 背景・課題

`scripts/auto-create-session.ts` は毎日 06:00 JST に GitHub Actions で実行され、
翌日（または `nearest` モードで直近）の E-ToMo 開催予定からセッションを自動作成する。

同じ対象日を手動で再実行（`workflow_dispatch`）した場合、既に
`etomoEventId` が一致するセッションが存在すると `processEvents` は
**スキップするだけ**だった（`notifySkipped`）。

しかし当日になって E-ToMo 側の出欠登録は変動する
（新規出席登録 / 欠席への変更）。手動再実行時にこの変動を
セッションへ反映したい、という要望。

## 要件

再実行時にセッションが既に存在する場合、スキップの代わりに以下を行う:

1. E-ToMo の最新出席者リスト（`event.participants`）と、既存セッションの
   `gameState.players`（実際のロースター）を突き合わせる。
2. **新規出席登録**: 最新リストにいるが既存セッションにいない名前 →
   プレイヤーを追加する（`isResting: true` で待機状態、序列/性別は
   tmp シート経由の `memberMap` から補完。既存の新規作成ロジック
   `buildSessionData` の player 構築と同じルール）。
3. **欠席への変更**: 既存セッションにいるが最新リストにいない名前 →
   プレイヤーを削除する。削除時は `src/services/sessionMutations.ts` の
   `computeRemovePlayer` と同じ整合性ルールを踏襲する
   （コートの teamA/teamB 該当スロットを空文字に、
   `restingPlayerIds` から除外、予約 `playerIds` から除外し空になった
   予約は削除。`matchHistory` はそのまま＝過去の試合記録は変更しない）。
4. 変更があった場合のみ Firestore を更新し（`gameState` + `registeredPlayers`
   + `updatedAt`）、Discord に追加/削除サマリを通知する。
   変更が無ければ「同期済み・変更なし」を通知するのみで書き込みは行わない。

## 非対象（今回は変更しない）

- `admins`（管理者候補）リストの再計算 — 今回はセッション作成時のみ設定する
  現行仕様を維持する。
- 序列未設定（`checkPlayerIssues`）による追加のブロック — 既存セッションへの
  追加は「出席が確定した」という事実を反映するのが目的なので、序列が
  tmp シートに無くてもブロックしない（`rating: undefined` のまま追加、
  後から通常の名簿編集 UI で補完できる）。

## 実装方針

`scripts/auto-create-session.ts` は React アプリ本体（`src/`）の
Firebase クライアント（`src/lib/firebase.ts`, `import.meta.env` 依存）を
import すると `tsx` 実行時に壊れるため、**既存の書き方に倣い
このスクリプト内に自己完結したロジックとして再実装する**
（`generateSessionId` 等、既存コードも同様の重複を許容している）。
型（`GameState` / `Player` / `Court` / `Reservation`）のみ
`import type` で `src/` から参照する（型は erase されるので安全）。

### 追加する純粋関数（ユニットテスト対象、既存の `export {}` に追加）

- `computeRosterDiff(currentNames: string[], latestNames: string[]): { toAdd: string[]; toRemove: string[] }`
  - `toAdd` = latestNames のうち currentNames に無いもの
  - `toRemove` = currentNames のうち latestNames に無いもの
- `computeRosterSync(state: GameState, event: EtomoEventDetail, memberMap: Map<string, MemberData>): { state: GameState; added: string[]; removed: string[] }`
  - 内部で上記 diff を取り、追加プレイヤー生成（`buildSessionData` の
    player 構築ルールと同じ: `rating = 1000 - ordering`、`gender` は
    E-ToMo 詳細の色 or memberMap 補完、`isResting: true` 等）と
    削除（コート/予約の参照整合性を保つ）を行う。

### 追加する I/O 関数（非テスト対象、既存の他 Firestore 関数と同様の扱い）

- `fetchCreatedEventIds` を `fetchCreatedSessions(db, eventIds): Promise<Map<eventId, sessionId>>`
  に変更（既存呼び出し元を更新）。
- `syncSessionRoster(db, sessionId, event, memberMap): Promise<{ added: string[]; removed: string[] }>`
  - `runTransaction` で読み取り → `computeRosterSync` → 変更があれば
    `transaction.update(ref, { gameState: sanitize(next), registeredPlayers, updatedAt: serverTimestamp() })`。
  - `gameState` が存在しないセッションは想定外なのでエラーを投げる。
- `notifySessionSynced(event, sessionId, targetDate, added, removed)`:
  Discord 通知（🔄 メンバー同期完了、追加/削除リスト）。
- 変更なし時の通知は既存の `notifySkipped` を流用しつつメッセージ文言を
  「同期済み・変更なし」に更新する（「スキップ」という言葉が実態と
  合わなくなるため）。

### `processEvents` の変更

```
既存セッションが見つかった場合:
  syncSessionRoster を呼ぶ
  added/removed が両方空 → notifySkipped 相当（変更なし通知）
  それ以外 → notifySessionSynced
  （どちらのケースも次のイベントへ continue、新規作成ロジックは通らない）
```

## テスト

`scripts/auto-create-session.test.ts` に追加:

- `computeRosterDiff`: 追加のみ / 削除のみ / 両方 / 変化なし の各ケース
- `computeRosterSync`:
  - 新規追加プレイヤーが `isResting: true` / `gamesPlayed: 0` などの
    初期値で追加されること、memberMap から rating/gender が補完されること
  - 削除対象プレイヤーがコートの teamA/teamB から除去されること
  - 削除対象プレイヤーが `restingPlayerIds` から除去されること
  - 削除により空になった予約が削除され、空にならない予約は該当 ID だけ
    除去されること
  - `matchHistory` が変更されないこと

## 受け入れ確認

- `npm run build` / `npm run lint` / `npm run test:run` が通ること
- 既存の `buildSessionData` 等の既存テストが壊れないこと
