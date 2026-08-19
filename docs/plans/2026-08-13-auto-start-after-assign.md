# 配置後3分での試合自動開始

## 背景 / 課題

コート単体の「配置」ボタンで配置した後、「開始」ボタンを押し忘れるケースが頻発している。

- 配置直後のコートは `isPlaying=false` / `startedAt=0` のまま「準備中」表示になる。
- 開始が押されないと `startedAt` が入らないため、
  - 経過時間タイマーが動かない
  - 15分超過の自動終了（`MATCH_AUTO_END_MS`）も発火しない
  - 試合履歴に残らず、次の配置もできない

一括配置（全コート同時配置）と連続モードの配置は配置と同時に `isPlaying=true` に
なるため、この問題は **コート単体配置のみ** で起きる。

## 要件

1. 配置後そのまま **3分** 経過したら、自動で試合開始扱いにする。
2. 自動開始時の `startedAt` は **配置したタイミング**（3分後ではなく配置時刻）とする。

## 設計

### Court に `assignedAt` を追加

```ts
export interface Court {
  ...
  /** コートに配置した時刻（Unix timestamp、未設定時は0）。3分後の自動開始の基準。 */
  assignedAt: number;
}
```

- `EMPTY_COURT_STATE` に `assignedAt: 0` を追加（コートのクリア／試合終了で 0 に戻る）。
- 配置時（`autoAssignAndFulfill`）に `assignedAt = 配置時刻` を書き込む。
  一括配置・連続モード配置は `isPlaying=true` かつ `startedAt = assignedAt` なので、
  自動開始の対象にはならない（ただし値としては同じ配置時刻を持たせる）。
- 旧データ（`assignedAt` 無し）は `?? 0` 扱いで自動開始の対象外。手動「開始」は従来どおり。

### 自動開始 mutation

`sessionMutations.autoStartMatch(sessionId, courtId, assignedAt)`

- `runTransaction` でリモートを読み、
  - コートに配置が無い / 既に `isPlaying=true` / `assignedAt` が変化している
    → `already_started` を返して **書き込まない**（べき等キー = `assignedAt`）
  - それ以外 → `isPlaying=true`, `startedAt = assignedAt` を書き込む
- 15分自動終了（`finishMatchAndContinue` の `startedAt` べき等キー）と同じ考え方。
  全端末が同時に発火しても 1 回だけ成功する。

### 発火（MainPage）

15分自動終了と同じ setTimeout パターン:

- 「配置済みだが未開始」のコート（`teamA[0]` あり / `!isPlaying` / `assignedAt > 0`）
  ごとに `assignedAt + MATCH_AUTO_START_MS` で `setTimeout`。
- 依存は `(id, assignedAt)` のシグネチャのみ（スコアやメンバー交換で再スケジュールしない）。
- 既に3分経過済みなら即発火（PWA 復帰・遅参加端末でも回収される）。
- 手動でメンバーを入れ替えても `assignedAt` は変えない（配置時刻の意味を保つ）。

### 通知の扱い

`useFirebaseSync.checkMatchStartNotifications` は「開始から2分以上経過していれば
通知しない」ガードを持つ。自動開始は `startedAt` が3分前になるため、そのままだと
通知が出ない。ガードの意図は **リロード時（初回スナップショット）の誤通知防止** なので、

- 初回スナップショット（`oldCourt` が無い）→ 従来どおり2分ガード
- 実際に `isPlaying: false → true` の遷移を観測した場合 → 経過時間に関わらず通知

に変更する。

### UI

「準備中」のコートに、配置からの経過時間をグレーのバッジで表示する
（プレイ中の青いタイマーと区別）。3分で自動開始されることが伝わるようにする。

## 変更ファイル

- `src/types/court.ts` — `assignedAt` 追加
- `src/lib/gameOperations.ts` — `MATCH_AUTO_START_MS` 定義 / 連続配置で `assignedAt` 設定
- `src/services/sessionMutations.ts` — `AutoAssignSpec.assignedAt` / `autoStartMatch`
- `src/pages/MainPage.tsx` — 配置時に `assignedAt` を渡す / 自動開始タイマー / 準備中タイマー表示
- `src/hooks/useFirebaseSync.ts` — 開始通知ガードの調整
- テスト: `sessionMutations.test.ts`

## 非対象

- 3分の閾値は定数（`MATCH_AUTO_START_MS`）でハードコード。設定 UI は作らない。

## 改訂（2026-08-19）: 手動開始も `assignedAt` を採用し、準備中タイマーは非表示

当初は「手動『開始』の `startedAt` は押した時刻」としていたが、実運用で謎仕様になっていた。

- 準備中のコートでグレーのタイマーがカウントアップしている
- しかし「開始」を押すと、そこまで数えた時間は捨てられ 0:00 から始まる
- 一方 3 分放置して自動開始した場合は配置時刻から数え始める（＝ 3:00 で開始）

つまり**同じ「準備中」から始めても、手動か自動かで試合開始時刻の意味が変わり**、
表示されているタイマーが何を意味するのかも読めなかった。次の試合のメンバーを
コート付近で待機させる運用（`2026-08-18-finish-operation-guide.md`）になり、経過時間が
「そろそろ終わる」の判断材料として重みを増したことで、この不一致が実害になった。

- **手動開始も `startedAt = assignedAt`** にする（`computeStartGame`）。どちらの経路でも
  「配置した時刻＝試合開始」で一貫する。`assignedAt` を持たない旧データは従来どおり
  押した時刻。
- **準備中のタイマー表示は削除**する。`assignedAt` は自動開始のスケジュールと開始時刻の
  ためだけに裏で保持し、画面には出さない（コートカードのヘッダーは試合中の経過時間に
  専念する）。

副作用として、準備中が長かったコートを手動開始すると開始直後から経過時間が進んだ
状態になる。`FinishGameButton` の 10 秒ロックと「1分以内の終了は確認ダイアログ」
（`2026-05-30-quick-finish-confirmation.md`）は `startedAt` 起点なので、その場合は
どちらも効かない。自動開始が 3 分で走る以上ずれは最大 3 分で、実害は小さいと判断した。
