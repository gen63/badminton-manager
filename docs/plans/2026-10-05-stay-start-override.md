# 滞在時間モードの到着調整（旧称: みなし開始時刻）

## 目的

参加時間公平モード（滞在時間モード `useStayDurationPriority`）で、実際の起点
（会費・名簿の両方完了＝受付完了時刻など）とは別に、公平計算用の開始時刻を管理者が設定・解除できるようにする。

- 事前に遅刻の連絡があった人 → 遅刻した時間もいたものとして扱う（救済）。遅刻幅を 1/2・1/3・0 にする運用。
  遅刻連絡は到着前に来るので、受付前に倍率を予約でき、受付完了時に自動で効く。
- 時間どおりに来たが体調が悪く、あまり試合に入れない人 → 遅刻してきたものとして扱う（控えめ）。
- 時間どおりに来た人が一番多く試合に入れる点は変えない。

呼び方は UI 上「到着調整」に統一する（参加者一覧のバッジと同じ）。本文中の「みなし開始時刻」は旧称。
コード上の識別子と本ファイル名はそのまま。

## 仕様

### 1. データ: `Player.arrivalAdjustment`

```ts
export type ArrivalAdjustment =
  | { kind: 'offset'; min: number }   // 練習開始から min 分後（整数、0 以上）から参加していたとみなす
  | { kind: 'ratio'; ratio: number }; // 実際の遅刻幅に ratio（0〜1。1/2・1/3・0）を掛ける（救済）

arrivalAdjustment?: ArrivalAdjustment; // 未設定時は従来ルール
```

- 1フィールドなので offset と ratio は構造上どちらか一方だけ（排他のためのコードは不要）。
- offset は絶対時刻ではなく**練習開始からの分数**。練習の日付・開始時刻を変えても遅刻幅が保たれる。
- 経緯: 初版は絶対時刻 `stayStartOverrideAt`、次に `stayStartOffsetMin` と `lateReliefRatio` の2フィールドだったが、
  master 未マージのうちに1フィールドへまとめた（移行処理なし）。

### 2. 滞在開始時刻の決定ルール（`src/lib/stayStart.ts`）

`docs/plans/2026-08-11-stay-start-at-ops-complete.md` の表を拡張し、上から順に判定する
（`describeStayStart` が1回の計算で起点と表示用の目印を返し、`resolveStayStart` はその `start`）:

| プレイヤーの状態 | 滞在開始時刻 |
| --- | --- |
| 会費・名簿のどちらか未完了（受付未完了 `opsIncomplete`） | `now`（＝滞在 0。到着調整があっても同じ） |
| 受付完了 & `{kind:'offset', min}` & `practiceStartTime > 0` | `min(now, practiceStartTime + max(0, min) 分)` |
| 受付完了時刻が分かる（`known`） & `{kind:'ratio', ratio}` & `practiceStartTime > 0` | `min(now, practiceStartTime + round((従来の起点 - practiceStartTime) × ratio))`（遅刻 0 以下は練習開始のまま） |
| 受付完了 & `opsCompletedAt` あり | `max(practiceStartTime, opsCompletedAt)` |
| 受付完了 & `opsCompletedAt` なし（既存セッション互換） | `max(practiceStartTime, activatedAt ?? now)` |

- 従来の起点は `resolveActualStayStart` が判別できる形で返す:
  `opsIncomplete`（受付未完了。来て試合に出ている人も含む）/ `known`（`opsCompletedAt`、または `activatedAt > 0`）/
  `unknown`（どちらも無く練習開始か now に落ちている）。
- `unknown` の人には ratio を適用しない（従来の起点のまま）。offset は練習開始が基準なので適用する。
- 練習開始時刻が無い（0／未定義）古いセッションでは到着調整を無視する。表示・期待試合数（playerStats）、
  予約ゲート、algorithm のすべてが同じ関数を通るので一致する。
- 回数平均モードでは滞在を使わないので効かない（設定は可能）。
- `describeStayStart` の目印:
  - `adjusted`: 到着調整が実際に効いているか。起点と従来の起点を**分に丸めて**比べる
    （受付完了 19:40:23 に 19:40 を入れても効いていない扱い）。
  - `reliefReserved`: 受付未完了で ratio を予約済み（練習開始時刻あり）。

### 3. 書き込み

- 専用 mutation は作らず、`computeUpdatePlayer` / `updatePlayer` で名前などと**1回の transaction**で保存する。
  - 型 `PlayerUpdates`: `arrivalAdjustment` だけ `ArrivalAdjustment | null` を受け付ける。
  - 値: `normalizeArrivalAdjustment` で kind ごとに検証・正規化（offset: 有限の数値を四捨五入・0 未満は 0、
    ratio: 有限で 0〜1）。不正なら `SessionError('invalid-argument')`。
  - `null`: フィールドごと削除（従来ルールに戻る）。省略（undefined）は変更なし。
  - 他のフィールド・他のプレイヤーは変更しない。

### 4. UI（`PlayerEditModal`、管理者のみ）

- 見出し「到着調整」の右端に `受付完了 19:40`（会費・名簿が両方完了した時刻）。
  受付未完了は `受付未完了`、`unknown` は `受付完了 不明`。
- 時刻欄（`<input type="time">`）＋「解除」は全員に出す（offset は練習開始が基準なので受付未完了でも設定できる）。
  - HH:MM → 分数（`parseStayOffsetTime`）: 練習開始と同じ日付で解釈し、開始より前で差が **12時間以上なら翌日**
    （23:00 開始で 00:30 → 90分）、12時間未満なら**開始前の受付＝遅刻なし（0分）**（19:00 開始で 18:50 → 0）。
    分数 → HH:MM（`formatStayOffsetTime`）は練習開始＋分数を `formatHHMM` で表示。
    時刻のパースは `practiceEndPhase.ts` の `timeOnSameDay`（`buildPracticeEndTime` と共通）。
  - 受付未完了の人が時刻を入れた場合は「（受付完了後に有効）」と注記。
- 遅刻幅の推移（入力中にリアルタイム更新、`describeLateChange`）:
  未設定 `遅刻 40分` / `遅刻なし`、時刻 `遅刻 40分 → 20分（-20分）`、調整の方が遅い `遅刻 0分 → 30分（+30分）`、
  倍率 `遅刻 40分 → 20分（1/2）`、受付完了時刻なし `調整後の遅刻 20分`。
  その下に効果の一言（`lateChangeEffect`）: 縮んだ `→ 試合に入りやすくなります`（`text-primary`）、
  増えた `→ 試合数が控えめになります`（`text-muted-foreground`）。変化なし・未入力は出さない。
- 救済グループ（`RELIEF_RATIOS`: 1/2・1/3・0）は ratio を設定する。選択中のボタンを強調し、もう一度押すと解除。
  - 表示条件（`showReliefOptions(status, 遅刻分, 倍率あり)`）:
    受付未完了は常に（ラベル「遅刻連絡あり（受付完了時に適用）」、選択中は「受付完了時に遅刻幅を 1/2 にします」と注記）、
    `unknown` は出さない、`known` は倍率設定済みか、実際の遅刻が `RELIEF_GRACE_MIN`（10分）を**超える**場合
    （10分→出さない、11分→出す。ラベル「救済（遅刻幅を縮める）」）。猶予は表示条件だけで計算には影響しない。
  - `known` の人が ratio を選ぶと、時刻欄には計算結果の時刻を表示するだけ。時刻の手入力・控えめボタン・
    「解除」を使うと ratio は解除され offset 方式になる。
- 控えめグループ（`+15分` / `+30分` / `+60分`）: `known` の人だけ（受付未完了・不明は実際の遅刻が分からないので出さない）。
  offset = 実際の遅刻分 + N分（`restrainOffsetOption`。実際の起点基準なので押し直しても累積しない）。
  調整後の開始が練習終了時刻（`resolvePracticeEndTime`）以降になるボタンは**無効化**する
  （頭打ちだと +30 と +60 が同じ値になり紛らわしく、滞在0は「控えめ」の範囲を超えるため）。
- クイックボタンの見た目は DESIGN.md「選択状態」に合わせる:
  非選択 `bg-secondary text-secondary-foreground`、選択中 `bg-primary text-primary-foreground shadow-lg ring-2 ring-primary/30 scale-105`。
- 説明文:「遅刻連絡のあった人は早めに（救済。受付前でも倍率を予約できます）、体調不良などで控えめにしたい人は
  遅めに設定します。滞在時間モードの公平計算にだけ使います。」
- 練習開始時刻が無いセッションでは欄を無効化し「練習開始時刻が未設定のため使えません」、
  回数平均モード中は「現在は効きません」と注記。
- `onSave` はオブジェクト引数（`PlayerEditSaveValues`）。`arrivalAdjustment` は
  undefined＝変更なし / null＝解除 / 値＝設定。変更の有無は `buildArrivalAdjustmentUpdate`（純粋関数）だけで判定し、
  `PlayerSelect.handleEditSave` はそのまま `updatePlayer` に渡す（比較しない）。
- 従来の起点は `PlayerSelect.handleEdit` で `resolveActualStayStart` を計算して props で渡す
  （now は画面表示時に固定した値。`activatedAt` 欠損時のフォールバックにしか効かない）。

### 5. 参加者一覧（`GameStatsRows`、予約追加の `PlayerPickList` も共用）

- 到着調整が実際に効いている人（`StayInfo.overridden` ＝ `adjusted`）に小さな「到着調整」バッジ。
- 受付未完了で ratio を予約済みの人（`StayInfo.reliefReserved`）に小さな「遅刻連絡」バッジ。
- どちらも全員向けに表示（滞在時間モードの期待差ソート時）。スタイルは共通（`bg-primary/10 text-primary`）。
- `computeStayStats` は1人あたり1回 `describeStayStart` を呼び、起点・完了状態・目印をそこから導く。

## 変更ファイル

- `src/types/player.ts` — `ArrivalAdjustment` 型と `Player.arrivalAdjustment`
- `src/lib/stayStart.ts` — `resolveStayStart` / `describeStayStart` / `resolveActualStayStart` / `applyLateRelief` /
  `normalizeArrivalAdjustment` / `lateMinutes` / `RELIEF_RATIOS` / `formatReliefRatio` / `reliefReservationNote` /
  `formatStayOffsetTime` / `parseStayOffsetTime` / `describeLateChange` / `restrainOffsetOption` / `lateChangeEffect` /
  `LATE_CHANGE_EFFECT_TEXT` / `RELIEF_GRACE_MIN` / `showReliefOptions` / `buildArrivalAdjustmentUpdate`
- `src/lib/practiceEndPhase.ts` — `timeOnSameDay` を切り出し `buildPracticeEndTime` と共用（挙動不変）
- `src/lib/playerStats.ts` — `StayInfo.overridden` / `reliefReserved`、`computeStayStats` の1回計算化
- `src/services/sessionMutations.ts` — `PlayerUpdates`、`computeUpdatePlayer` の `arrivalAdjustment`（null で削除）
- `src/hooks/useSessionWriter.ts` — `updatePlayer` の型
- `src/components/PlayerEditModal.tsx` — 到着調整欄（受付完了表示・時刻欄・推移・効果・救済/控えめボタン）、`onSave` のオブジェクト引数化
- `src/pages/PlayerSelect.tsx` — 保存処理（1 transaction）・モーダルへの受け渡し
- `src/components/GameStatsRows.tsx` — 「到着調整」「遅刻連絡」バッジ

## 後方互換

- フィールドは optional。未設定なら従来どおりの起点（挙動変化なし）。
- 解除はフィールド削除なので、Firestore 上も未設定と区別がない。
- 古いクライアントは未知のフィールドを無視する（`computeUpdatePlayer` の spread でも保持される）。

## テスト

- `src/lib/stayStart.test.ts`:
  - offset: 未設定・早め・遅め・負は練習開始で頭打ち・未来は now で頭打ち・受付未完了なら now・
    `opsCompletedAt` なしでも優先・練習開始時刻なしは無視・開始時刻を動かしても遅刻幅維持。
  - ratio: 受付未完了・0.5・1/3・0・遅刻なし・now で頭打ち・練習開始時刻なし・`unknown` には適用しない。
  - `resolveActualStayStart`（known/unknown/opsIncomplete）、`describeStayStart` の `adjusted`
    （19:40:23 に 19:40 → false を含む）と `reliefReserved`、`normalizeArrivalAdjustment`（kind ごとの検証）。
  - `lateMinutes`、`applyLateRelief`、HH:MM⇔分数（12時間ルール・日付またぎ）、`describeLateChange`、
    `formatReliefRatio` / `reliefReservationNote`、`restrainOffsetOption`、`lateChangeEffect`、
    `showReliefOptions`（10/11分の境界・受付未完了は常に・unknown は出さない）、`buildArrivalAdjustmentUpdate`。
- `src/services/sessionMutations.test.ts`: `computeUpdatePlayer` で設定・kind 切替・解除（フィールド削除）・
  省略時保持・丸め・kind ごとの不正値、`updatePlayer` で名前変更と解除が1回の transaction になること。
- `src/lib/algorithm.test.ts`: 同じ試合数なら、到着調整で開始が早い人が優先される。
- `src/lib/playerStats.test.ts`: 期待試合数への反映と `overridden`、練習開始時刻なしでは無視、`reliefReserved`。

## 非対象

- 非管理者（本人）による設定。
- 途中で帰る人の扱い（みなし終了時刻）。
