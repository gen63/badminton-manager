# 未払いメンバーの強制休憩 + 全員通知

2026-07-09

## 背景 / 要望

- 名簿上、会費の支払いが済んでいないメンバーが度々出てくる。
- 以下 2 条件を **両方** 満たす未払いメンバーは強制的に休憩にしたい:
  1. 試合を 1 回以上消化している（`gamesPlayed >= 1`）
  2. 一定時間が経過している
- 強制休憩を実施したことを **全メンバーに通知** したい。
  たまたま元々休憩中だった場合でも、通知自体は行いたい。

## 現状把握

- 支払い状態は `Player.operationStatus.payment`（クライアント側チェックのみ）。
- 自動処理の既存パターン:
  - 90 分自動オン（`markLateBalanceAutoFired`）: Firestore フラグをべき等キーに
    して全端末で発火させても 1 度だけ実施。
  - 15 分自動終了（`autoEndMatch`）: MainPage の setTimeout + `startedAt` べき等
    キー。成功した端末だけ toast。
- 全端末への通知は `notifyMatchStart`（Browser Notification）方式:
  `useFirebaseSync` の onSnapshot で前後状態を比較し、各端末がローカルで
  Notification を出す。通知許可はセッション参加/作成時にリクエスト済み。

## 設計

### 1. `Player.unpaidRestAt?: number` を追加

- 「未払い強制休憩を実施・通知した時刻」。未実施は undefined。
- **べき等マーカー**を兼ねる: 一度セットしたら同じプレイヤーには再発火しない
  （毎分のチェックで通知が連打されるのを防ぐ）。
- 誤登録訂正（支払い→未払いに戻す）でも再発火しない（既に休憩済みのはずで、
  再通知はノイズになるため）。

### 2. `computeEnforceUnpaidRest`（純粋関数, `sessionMutations.ts`）

- 対象条件（すべて AND）:
  - `!operationStatus?.payment`（未払い）
  - `unpaidRestAt` 未セット
  - `gamesPlayed >= 1`
  - 経過時間: `now - baseline >= UNPAID_REST_GRACE_MS`（30 分）。
    `baseline = activatedAt`（チェックイン時刻）、0 なら `lastPlayedAt` に
    フォールバック（自動配置系は activatedAt を積まない経路があるため）。
  - コート上にいない（試合中のメンバーは引き剥がさない。試合終了後の
    次回チェックで対象化される）
- 対象者に `isResting: true` + `unpaidRestAt: now` をセット。
  既に休憩中でもマーカーはセットし、`enforced` に含める（= 通知対象）。
- 戻り値 `{ state, enforced: Player[] }`。

### 3. `enforceUnpaidRest`（トランザクションラッパー）

- 専用 `runTransaction`: `enforced` が空なら **書き込まずに** 返す
  （毎分の定期チェックで無駄な write / updatedAt 更新をしない）。
- `now` はクロージャで 1 度だけ生成（リトライ時も同値 = idempotent）。

### 4. 定期チェック（MainPage）

- 60 秒間隔の `setInterval` + マウント時即時実行。`isGameStateLoaded` ガード。
- ローカルストア状態で `computeEnforceUnpaidRest` を先に評価し、候補ゼロなら
  transaction を投げない（全端末×毎分の read を抑制）。
- 全端末で走らせても `unpaidRestAt` マーカーにより 1 端末だけが書き込む。
- 実施に成功した端末は toast でも表示（autoEndMatch と同型）。

### 5. 全員通知（`useFirebaseSync` + `notifications.ts`）

- `notifyUnpaidRest(playerName)` を `notifications.ts` に追加
  （Browser Notification。`notifyMatchStart` と同型）。
- `useFirebaseSync` の onSnapshot 反映前に新旧 players を比較…ではなく、
  受信 players の `unpaidRestAt` を走査:
  - `${playerId}-${unpaidRestAt}` をキーに module スコープの Set で重複防止
    （`notifiedMatches` と同じ方式、セッション切替でクリア）。
  - `unpaidRestAt` から 2 分超過は通知しない（リロード時の誤通知防止、
    match-start 通知と同じガード）。
- 実施端末自身も onSnapshot を受けるので、全端末（通知許可済み）に届く。

## スコープ外

- 猶予時間 30 分の設定 UI 化（`UNPAID_REST_GRACE_MS` 定数、必要なら後日）。
- 強制休憩後の予約経由での再出場ブロック（管理者が通知を見て運用対応）。
- 支払い完了時の自動「待機」復帰（手動でトグルする運用のまま）。
- Undo（自動発火のため Undo スタックには積まない）。

## 確認

- `npm run build` / `npm run lint` / `npm run test:run`
- `sessionMutations.test.ts` に `computeEnforceUnpaidRest` / `enforceUnpaidRest`
  のユニットテストを追加。
