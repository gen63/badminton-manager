# 滞在時間モードの「みなし開始時刻」（到着調整）

## 目的

参加時間公平モード（滞在時間モード `useStayDurationPriority`）で、実際の起点
（会費・名簿の完了＝受付完了時刻など）とは別に、公平計算用の開始時刻を管理者が設定・解除できるようにする。

- 事前に遅刻の連絡があった人 → 遅刻した時間もいたものとして扱う（実際より**早い**開始時刻）。
  滞在が長くなり、試合数が少ない分だけ優先される。遅刻幅を 1/2・1/3 にする救済運用を想定。
- 時間どおりに来たが体調が悪く、あまり試合に入れない人 → 遅刻してきたものとして扱う
  （実際より**遅い**開始時刻）。滞在が短くなり、少ない試合数でも公平とみなされる。
- 時間どおりに来た人が一番多く試合に入れる点は変えない。

## 仕様

### 1. 新フィールド `Player.stayStartOffsetMin`

```ts
stayStartOffsetMin?: number; // 到着調整（みなし開始時刻）を「練習開始から何分後か」（整数、0 以上）で持つ。未設定時は従来ルール
```

- 絶対時刻ではなく**練習開始からの分数**で持つ。練習の日付・開始時刻を変えても遅刻幅が保たれる。
- 初版（a8b91e6）は絶対時刻 `stayStartOverrideAt` だったが、master 未マージのうちに置き換えた（移行処理なし）。

### 2. 滞在開始時刻の決定ルール（`src/lib/stayStart.ts` の `resolveStayStart`）

`docs/plans/2026-08-11-stay-start-at-ops-complete.md` の表を拡張し、上から順に判定する:

| プレイヤーの状態 | 滞在開始時刻 |
| --- | --- |
| 会費・名簿のどちらか未完了 | `now`（＝滞在 0。到着調整があっても同じ） |
| 会費・名簿とも完了 & `stayStartOffsetMin` あり & `practiceStartTime > 0` | `min(now, practiceStartTime + max(0, offset) 分)` |
| 会費・名簿とも完了 & `opsCompletedAt` あり | `max(practiceStartTime, opsCompletedAt)` |
| 会費・名簿とも完了 & `opsCompletedAt` なし（既存セッション互換） | `max(practiceStartTime, activatedAt ?? now)` |

- 実際の受付完了より早くも遅くもできる。負の値は 0（練習開始）、未来になる値は now で頭打ち。
- 練習開始時刻が無い（0／未定義）古いセッションでは到着調整を無視する。表示・期待試合数（playerStats）、
  予約ゲート、algorithm のすべてが `resolveStayStart` を通るので一致する。
- 回数平均モードでは滞在を使わないので効かない（設定は可能）。
- `resolveActualStayStart(player, practiceStartTime, now)` は到着調整を無視した従来の起点を
  判別できる形で返す: `notArrived`（未完了）/ `known`（`opsCompletedAt`、または `activatedAt > 0`）/
  `unknown`（どちらも無く練習開始か now に落ちている）。`resolveStayStart` はこれを使う（挙動は従来どおり）。
- `isStayStartAdjusted` = 到着調整ありの起点が従来の起点と異なるか（実際に効いているか）。

### 3. 書き込み

- 専用 mutation は作らず、`computeUpdatePlayer` / `updatePlayer` で名前などと**1回の transaction**で保存する。
  - 型 `PlayerUpdates`: `stayStartOffsetMin` だけ `number | null` を受け付ける。
  - 数値: 四捨五入して整数・負は 0 にしてセット。有限でない値は `SessionError('invalid-argument')`。
  - `null`: フィールドごと削除（従来ルールに戻る）。省略（undefined）は変更なし。
  - 他のフィールド・他のプレイヤーは変更しない。

### 4. UI

- `PlayerEditModal` に管理者のみの「みなし開始時刻」欄（`<input type="time">` ＋「解除」）。
  - 見出し右端に `受付完了 19:40`（会費・名簿が両方完了した時刻）。未完了は `未到着`、
    `unknown` は `受付完了 不明`。
  - 入力欄の下に遅刻幅の推移（入力中にリアルタイム更新、`describeLateChange`）:
    未設定 `遅刻 40分` / `遅刻なし`、入力あり `遅刻 40分 → 20分（-20分）`、
    調整の方が遅い `遅刻 0分 → 30分（+30分）`、受付完了時刻なし `調整後の遅刻 20分`
    （未到着のときだけ「到着（会費・名簿完了）後に有効」と注記）。
  - 救済クイックボタン `遅刻幅 1/2` / `1/3` / `0（遅刻なしとみなす）`: 分数 = `round(実際の遅刻分 × 比率)`
    （`reliefOffsetMin`）を入力欄に入れる。受付完了時刻が分かり（`known`）実際に遅刻している人だけ出す。
  - HH:MM → 分数（`parseStayOffsetTime`）: 練習開始と同じ日付で解釈し、
    開始より前で差が **12時間以上なら翌日**（23:00 開始で 00:30 → 90分）、
    12時間未満なら**開始前の受付＝遅刻なし（0分）**（19:00 開始で 18:50 → 0）。
    分数 → HH:MM（`formatStayOffsetTime`）は練習開始＋分数を `formatHHMM` で表示。
    時刻のパースは `practiceEndPhase.ts` の `timeOnSameDay`（`buildPracticeEndTime` と共通）。
  - 練習開始時刻が無いセッションでは欄を無効化し「練習開始時刻が未設定のため使えません」と注記。
  - 回数平均モード中は「現在は効きません」と注記。
  - `onSave` はオブジェクト引数（`PlayerEditSaveValues`）。`stayStartOffsetMin` は
    undefined＝変更なし / null＝解除 / 数値＝設定。変更の有無はモーダル側だけで判定し、
    `PlayerSelect.handleEditSave` はそのまま `updatePlayer` に渡す（比較しない）。
- 参加者一覧の滞在表示（`GameStatsRows`、予約追加の `PlayerPickList` も共用）で、
  到着調整が**実際に効いている**人（`StayInfo.overridden` ＝ `isStayStartAdjusted`）に
  小さな「到着調整」バッジ（`bg-primary/10 text-primary`）を全員向けに出す。

### 5. 追記: 控えめ（遅れて来たとみなす）パターンの UI

時間どおりに来た人にも「遅く来たことにする」操作を時刻計算なしでできるようにする。

- クイックボタンを2グループに分け、それぞれ text-xs のラベルを付ける:
  - **救済（遅刻幅を縮める）** `1/2` / `1/3` / `0`: 受付完了が known で実際に遅刻している人だけ。
  - **控えめ（遅れて来たとみなす）** `+15分` / `+30分` / `+60分`: 受付完了が known の人なら遅刻の有無にかかわらず。
    到着調整 = 実際の遅刻分 + N分（`restrainOffsetOption`。実際の起点基準なので押し直しても累積しない）。
    調整後の開始が練習終了時刻（`resolvePracticeEndTime`）以降になるボタンは**無効化**する
    （頭打ちにすると +30 と +60 が同じ値になって紛らわしく、滞在0は「控えめ」の範囲を超えるため）。
- 遅刻幅の推移の下に効果の一言（`lateChangeEffect` / `LATE_CHANGE_EFFECT_TEXT`）:
  縮んだ `→ 試合に入りやすくなります`（`text-primary`）、増えた `→ 試合数が控えめになります`（`text-muted-foreground`）。
  変化なし・未入力・受付完了時刻なしは出さない。
- 説明文:「遅刻連絡のあった人は早めに（救済）、体調不良などで控えめにしたい人は遅めに設定します。
  滞在時間モードの公平計算にだけ使います。」
- テスト: `stayStart.test.ts` に `restrainOffsetOption`（加算・非累積・終了時刻で無効・終了なし）と
  `lateChangeEffect` / 文言。

### 6. 追記: 救済ボタンの10分猶予

- 開始から10分以内の受付完了は「概ね時間どおり」とみなし、救済グループ（1/2・1/3・0）を出さない。
  実際の遅刻が `RELIEF_GRACE_MIN`（10分）を**超える**場合だけ出す（`showReliefOptions`。10分→出さない、11分→出す）。
- 控えめグループ（受付完了が known の人全員）、遅刻幅の表示（「遅刻 5分」など）、公平計算（`resolveStayStart`）は変更なし。
  猶予は UI の表示条件だけ。
- テスト: `stayStart.test.ts` に境界（0・10・11分、null）。

### 7. 追記: 呼び方を「到着調整」に統一

- UI 上の呼び方を、参加者一覧のバッジに合わせて「到着調整」に統一した（編集モーダルの欄見出し、
  形式エラー「到着調整の時刻の形式が正しくありません」、不正値の SessionError「到着調整の値が不正です」）。
  本文中の「みなし開始時刻」は同じ機能の旧称。コード上の識別子と本ファイル名はそのまま。

### 8. 追記: 到着前の救済倍率の予約（`lateReliefRatio`）

遅刻連絡は到着前に来るので、受付完了を待たずに救済の倍率を予約し、受付完了時に自動で効くようにする。

- データ: `Player.lateReliefRatio?: number`（0〜1。1/2=0.5、1/3、0＝全救済）。`stayStartOffsetMin` と**排他**。
  - `computeUpdatePlayer` が保証: 片方を数値で設定するともう片方を削除。null で削除。
    有限で 0〜1 以外、または両方を同時に数値指定は `SessionError('invalid-argument')`。
- 計算（`resolveStayStart`。§2 の表の「offset あり」の次に判定）:

| プレイヤーの状態 | 滞在開始時刻 |
| --- | --- |
| 会費・名簿とも完了 & `lateReliefRatio` あり & `practiceStartTime > 0` | `min(now, practiceStartTime + round((従来の起点 - practiceStartTime) × ratio))` |

  - 従来の起点は `resolveActualStayStart` の start（known/unknown どちらでも）。遅刻 0 以下は練習開始のまま（`applyLateRelief`）。
  - 未完了は従来どおり now。練習開始時刻なしは無視。両方ある不整合データは offset を優先。
  - `isStayStartAdjusted` は ratio にも対応（到着後に効いていれば「到着調整」バッジ）。
- UI（`PlayerEditModal`）:
  - 救済ボタン（1/2・1/3・0、`RELIEF_RATIOS`）は offset ではなく ratio を設定する。選択中は
    `bg-primary text-primary-foreground ring-2 ring-primary/30`＋「✓」で強調し、もう一度押すと解除。
  - 到着後に ratio を選ぶと、時刻欄には計算結果の時刻を表示するだけ。手で時刻を書き換える・控えめボタン・
    「解除」を使うと ratio は解除され offset 方式になる。推移は `遅刻 40分 → 20分（1/2）`。
  - 未到着（notArrived）: 救済グループを「遅刻連絡あり（到着時に適用）」のラベルで常に出す（10分猶予は適用しない）。
    選択中は「受付完了時に遅刻幅を 1/2 にします」と注記。時刻欄と控えめグループは出さない
    （既に時刻が設定されている場合だけ、解除できるよう時刻欄を出す）。
  - 到着済みで ratio 設定済み: 10分猶予にかかわらず救済グループを出す（選択状態を見せる。`showReliefOptions(status, late, hasRatio)`）。
  - 返り値 `PlayerEditSaveValues.lateReliefRatio` も「undefined＝変更なし / null＝解除 / 数値＝設定」。
    変更判定は `buildArrivalAdjustmentUpdate`（純粋関数）に集約。保存は従来どおり `updatePlayer` の1 transaction。
- 参加者一覧: 未到着で ratio を予約している人に小さな「遅刻連絡」バッジ（`StayInfo.reliefReserved` ＝ `isLateReliefReserved`）。
  受付完了後に効いていれば「到着調整」バッジ。
- テスト: `stayStart.test.ts`（ratio の各ケース・`applyLateRelief`・検証・表示文言・`showReliefOptions`・
  `buildArrivalAdjustmentUpdate`）、`sessionMutations.test.ts`（排他・解除・検証）、`playerStats.test.ts`（バッジ判定）。
  旧 `reliefOffsetMin` は不要になったので削除。

## 変更ファイル

- `src/types/player.ts` — `stayStartOffsetMin` 追加
- `src/lib/stayStart.ts` — 起点ルール拡張、`resolveActualStayStart` / `isStayStartAdjusted` /
  `lateMinutes` / `reliefOffsetMin` / `formatStayOffsetTime` / `parseStayOffsetTime` / `describeLateChange`
- `src/lib/practiceEndPhase.ts` — `timeOnSameDay` を切り出し `buildPracticeEndTime` と共用（挙動不変）
- `src/lib/playerStats.ts` — `StayInfo.overridden`
- `src/services/sessionMutations.ts` — `PlayerUpdates`、`computeUpdatePlayer` の `stayStartOffsetMin`（null で削除）
- `src/hooks/useSessionWriter.ts` — `updatePlayer` の型
- `src/components/PlayerEditModal.tsx` — 入力欄・受付完了表示・遅刻幅推移・救済ボタン・`onSave` のオブジェクト引数化
- `src/pages/PlayerSelect.tsx` — 保存処理（1 transaction）・モーダルへの受け渡し
- `src/components/GameStatsRows.tsx` — 「到着調整」バッジ

## 後方互換

- フィールドは optional。未設定なら従来どおりの起点（挙動変化なし）。
- 解除はフィールド削除なので、Firestore 上も未設定と区別がない。
- 古いクライアントは未知のフィールドを無視する（`computeUpdatePlayer` の spread でも保持される）。

## テスト

- `src/lib/stayStart.test.ts`: 未設定・早め・遅め・負は練習開始で頭打ち・未来は now で頭打ち・
  未完了なら now・`opsCompletedAt` なしでも優先・練習開始時刻なしは無視・開始時刻を動かしても遅刻幅維持、
  `resolveActualStayStart`（known/unknown/notArrived）、`isStayStartAdjusted`、`lateMinutes`、`reliefOffsetMin`、
  HH:MM⇔分数（12時間ルール・日付またぎ）、`describeLateChange`。
- `src/services/sessionMutations.test.ts`: `computeUpdatePlayer` で設定・解除（フィールド削除）・省略時保持・
  丸め・不正値、`updatePlayer` で名前変更と解除が1回の transaction になること。
- `src/lib/algorithm.test.ts`: 同じ試合数なら、到着調整で開始が早い人が優先される。
- `src/lib/playerStats.test.ts`: 期待試合数への反映と `overridden` 目印、練習開始時刻なしでは無視。

## 非対象

- 非管理者（本人）による設定。
- みなし「終了」時刻（途中で帰る人の扱い）。
