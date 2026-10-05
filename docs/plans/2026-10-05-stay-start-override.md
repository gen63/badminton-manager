# 滞在時間モードの「みなし開始時刻」

## 目的

参加時間公平モード（滞在時間モード `useStayDurationPriority`）で、実際の起点
（会費・名簿の完了時刻など）とは別に、公平計算用の開始時刻を管理者が設定・解除できるようにする。

- 事前に遅刻の連絡があった人 → 遅刻した時間もいたものとして扱う（実際より**早い**開始時刻）。
  滞在が長くなり、試合数が少ない分だけ優先される。
- 時間どおりに来たが体調が悪く、あまり試合に入れない人 → 遅刻してきたものとして扱う
  （実際より**遅い**開始時刻）。滞在が短くなり、少ない試合数でも公平とみなされる。

## 仕様

### 1. 新フィールド `Player.stayStartOverrideAt`

```ts
stayStartOverrideAt?: number; // 公平計算（滞在時間モード）用のみなし開始時刻（epoch ms）。未設定時は従来ルール
```

### 2. 滞在開始時刻の決定ルール（`src/lib/stayStart.ts` の `resolveStayStart`）

`docs/plans/2026-08-11-stay-start-at-ops-complete.md` の表を拡張し、上から順に判定する:

| プレイヤーの状態 | 滞在開始時刻 |
| --- | --- |
| 会費・名簿のどちらか未完了 | `now`（＝滞在 0。みなし開始時刻があっても同じ） |
| 会費・名簿とも完了 & `stayStartOverrideAt` あり | `min(now, max(practiceStartTime, stayStartOverrideAt))` |
| 会費・名簿とも完了 & `opsCompletedAt` あり | `max(practiceStartTime, opsCompletedAt)` |
| 会費・名簿とも完了 & `opsCompletedAt` なし（既存セッション互換） | `max(practiceStartTime, activatedAt ?? now)` |

- 実際の到着より早くも遅くもできる。練習開始前の値は練習開始時刻で、未来の値は now で頭打ち。
- 来ていない（会費・名簿未完了の）人の滞在は数えない方針を維持する。
- `calculatePriorityScore`（algorithm）、`computeStayStats` / 期待試合数（playerStats）、
  予約ゲート（reservationGate）はすべて `resolveStayStart` を通るため、一括で反映される。
- 回数平均モードでは滞在を使わないので効かない（設定は可能）。

### 3. 書き込み

- `computeSetStayStartOverride(state, playerId, value: number | null)`（純粋関数）と
  transaction wrapper `setStayStartOverride(sessionId, playerId, value)` を
  `src/services/sessionMutations.ts` に追加。
  - 数値: その時刻をセット。有限でない値は `SessionError('invalid-argument')`。
  - `null`: フィールドごと削除（従来ルールに戻る）。
  - 他のフィールド・他のプレイヤーは変更しない。
- `useSessionWriter` に `setStayStartOverride(id, value)` を追加。

### 4. UI

- `PlayerEditModal` に管理者のみの「みなし開始時刻」欄（`<input type="time">` ＋「解除」ボタン）。
  - `HH:MM` を練習日（`practiceStartTime` の日付。未設定なら今日）と組み合わせて端末ローカル時刻の ms に変換
    （`parseStayOverrideTime` / `formatStayOverrideTime`）。
  - 説明文:「滞在時間モードの公平計算で、この時刻から参加していたとみなします。遅刻連絡があった人は早く、
    体調不良などで控えめにしたい人は遅く設定」。回数平均モード中は「現在は効きません」と注記。
  - `onSave` はオブジェクト引数（`PlayerEditSaveValues`）にリファクタ。`stayStartOverrideAt` は
    undefined＝変更なし / null＝解除 / 数値＝設定。表示上の時刻が変わらなければ書き込まない。
- `PlayerSelect.handleEditSave`: 管理者かつ値が変わったときだけ、`updatePlayer` の後に
  `setStayStartOverride` を呼ぶ。
- 参加者一覧の滞在表示（`GameStatsRows`、予約追加の `PlayerPickList` も共用）で、
  設定済みかつ会費・名簿完了の人に小さな「みなし」バッジ（`bg-primary/10 text-primary`）を出す。
  `StayInfo.overridden` で判定。

## 変更ファイル

- `src/types/player.ts` — `stayStartOverrideAt` 追加
- `src/lib/stayStart.ts` — 起点ルール拡張、時刻入力の変換ヘルパー
- `src/lib/playerStats.ts` — `StayInfo.overridden`
- `src/services/sessionMutations.ts` — `computeSetStayStartOverride` / `setStayStartOverride`
- `src/hooks/useSessionWriter.ts` — `setStayStartOverride`
- `src/components/PlayerEditModal.tsx` — 入力欄・`onSave` のオブジェクト引数化
- `src/pages/PlayerSelect.tsx` — 保存処理・モーダルへの受け渡し
- `src/components/GameStatsRows.tsx` — 「みなし」バッジ

## 後方互換

- フィールドは optional。未設定なら従来どおりの起点（挙動変化なし）。
- 解除はフィールド削除なので、Firestore 上も未設定と区別がない。
- 古いクライアントは未知のフィールドを無視する（`computeUpdatePlayer` の spread でも保持される）。

## テスト

- `src/lib/stayStart.test.ts`（新設）: 未設定・早め・遅め・練習開始前は頭打ち・未来は now で頭打ち・
  会費/名簿未完了なら now・`opsCompletedAt` なしでも優先、時刻変換の往復と不正値。
- `src/services/sessionMutations.test.ts`: 設定・解除（フィールド削除）・上書き・他フィールド保持・不正値・存在しない ID。
- `src/lib/algorithm.test.ts`: 同じ試合数なら、みなし開始が早い人が優先される。
- `src/lib/playerStats.test.ts`: 期待試合数への反映と `overridden` 目印。

## 非対象

- 非管理者（本人）による設定。
- みなし「終了」時刻（途中で帰る人の扱い）。
