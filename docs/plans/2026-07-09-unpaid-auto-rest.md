# 会費・名簿未対応メンバー / 結果未登録試合の強制休憩 + 全員通知

2026-07-09（同日フィードバックで条件・通知方法を改訂、結果未登録試合へ拡張）

## 背景 / 要望

- 名簿上、会費の支払いが済んでいないメンバーが度々出てくる。
- 以下 2 条件を **両方** 満たす未対応メンバーは強制的に休憩にしたい:
  1. 試合を 1 回以上消化している
  2. 一定時間が経過している
- 強制休憩を実施したことを **全メンバーに通知** したい。
  たまたま元々休憩中だった場合でも、通知自体は行いたい。
- （フィードバック改訂）
  - Browser Notification の許可メンバーが少ないので **トーストでも** 知らせたい。
  - 会費未払いだけでなく **名簿未対応** も対象にしたい。
  - 経過時間の起点は「**本人が最初の試合を終えてから** 30 分」にしたい。

## 現状把握

- 支払い・名簿状態は `Player.operationStatus.payment / roster`。
- 自動処理の既存パターン:
  - 90 分自動オン（`markLateBalanceAutoFired`）: Firestore フラグをべき等キーに
    して全端末で発火させても 1 度だけ実施。
  - 15 分自動終了（`autoEndMatch`）: MainPage の setTimeout + `startedAt` べき等
    キー。
- 全端末への通知は `notifyMatchStart`（Browser Notification）方式:
  `useFirebaseSync` の onSnapshot で受信状態を検査し、各端末がローカルで
  Notification を出す。トーストは各ページの `useToast`（ローカル state）のみで、
  画面をまたぐグローバルトーストは存在しなかった。

## 設計

### 1. `Player.forcedRestAt?: number` を追加

- 「会費・名簿未対応による強制休憩を実施・通知した時刻」。未実施は undefined。
- **べき等マーカー**を兼ねる: 一度セットしたら同じプレイヤーには再発火しない
  （毎分のチェックで通知が連打されるのを防ぐ）。

### 2. `computeEnforceForcedRest`（純粋関数, `sessionMutations.ts`）

- 対象条件（すべて AND）:
  - 会費（payment）**または** 名簿（roster）が未対応
    （`unresolvedOpsOf(p)` で未対応項目を導出。operationStatus 未設定の
    旧データは両方未対応扱い）
  - `forcedRestAt` 未セット
  - **最初の試合を終えてから** `FORCED_REST_GRACE_MS`（30 分）以上経過。
    起点は matchHistory 中の本人出場試合の最古 `finishedAt`。
    試合未消化（履歴に出場試合なし）は対象外。
  - コート上にいない（試合中のメンバーは引き剥がさない。試合終了後の
    次回チェックで対象化される）
- 対象者に `isResting: true` + `forcedRestAt: now` をセット。
  既に休憩中でもマーカーはセットし、`enforced` に含める（= 通知対象）。

### 3. `enforceForcedRest`（トランザクションラッパー）

- 専用 `runTransaction`: `enforced` が空なら **書き込まずに** 返す
  （毎分の定期チェックで無駄な write / updatedAt 更新をしない）。
- `now` はクロージャで 1 度だけ生成（リトライ時も同値 = idempotent）。

### 4. 定期チェック（MainPage）

- 60 秒間隔の `setInterval` + マウント時即時実行。`isGameStateLoaded` ガード。
- ローカルストア状態（players / courts / matchHistory）で
  `computeEnforceForcedRest` を先に評価し、候補ゼロなら transaction を投げない。
- 全端末で走らせても `forcedRestAt` マーカーにより 1 端末だけが書き込む。
- 実施端末での通知はしない（下記 5. の onSnapshot 経路が実施端末にも届く）。

### 5. 全員通知（グローバルトースト + Browser Notification）

- **グローバルトースト基盤を新設**: `noticeStore`（zustand、非 persist）+
  App 直下の `GlobalNotices`。どの画面にいても表示され、`useFirebaseSync` の
  ような画面外コードから発火できる。通知許可が無いメンバーにも届く主経路。
- `useFirebaseSync` の onSnapshot で受信 players の `forcedRestAt` を走査:
  - `${playerId}-${forcedRestAt}` をキーに module スコープの Set で重複防止
    （セッション切替でクリア）。
  - `forcedRestAt` から 2 分超過は通知しない（リロード時の誤通知防止）。
  - 未対応項目は受信スナップショットの operationStatus から導出し、文言に反映:
    - 本人: 「会費の支払い（と名簿の記入）がまだのため、休憩になりました。
      対応後に休憩を解除してください」
    - 他メンバー: 「○○さんは会費の支払い（と名簿の記入）が未対応のため
      休憩になりました」
  - 同時に複数人が対象になった場合は、本人向け 1 件 + 他メンバーまとめ 1 件に
    集約する（結果未登録通知と同様）。まとめ文言の未対応項目はメンバー間の
    和集合を出す。
  - グローバルトースト（warning, 8 秒）+ `notifyForcedRest`（Browser
    Notification、許可済み端末のみ）の両方を出す。

### 6. 結果未登録試合への拡張（同方式の踏襲）

- **勝敗記録モード（`settings.recordScores === true`）のときのみ** 動作。
- **未登録試合が `UNRECORDED_REST_MIN_COUNT`（2）試合以上溜まっているときのみ**
  発動する。1 試合だけなら「直後でこれから入力する」可能性が高いので静観する。
  マーカー済み・猶予内の未登録試合も「溜まっている」数には含む
  （登録済みの試合は含まない）。
- `Match.forcedRestAt?: number` をべき等マーカーとして追加（**試合単位**）。
  結果を登録すれば条件から外れるので、同じメンバーが別の試合を未登録に
  すれば改めて発火する（会費・名簿のセッション 1 回きりとは異なる）。
- `computeEnforceUnrecordedRest`: 勝敗未入力（`scoreA===0 && scoreB===0 &&
  !winner`、HistoryPage / unrecordedMatchPrompt と同一判定式）かつ終了から
  `UNRECORDED_REST_GRACE_MS`（10 分）経過した試合にマーカーをセットし、
  出場者のうちコート上にいないメンバーを休憩にする。
  試合中のメンバーは引き剥がさない（全員が次の試合中でも、通知のために
  マーカーはセットする）。
- `enforceForcedRest` が会費・名簿分と未登録試合分を **1 transaction** で実施
  （どちらも対象ゼロなら書き込まない）。MainPage の毎分チェックも両方を
  ローカル事前評価する。
- 通知（`checkUnrecordedRestNotifications`）: `match.forcedRestAt` の新規セットを
  検出し、グローバルトースト + Browser Notification。文言:
  - 出場者本人: 「出場した試合の結果が未登録のため、休憩になりました。
    結果の登録をお願いします」
  - 他メンバー: 「○○さん・△△さん…は試合結果が未登録のため休憩になりました」

## スコープ外

- 猶予時間 30 分の設定 UI 化（`FORCED_REST_GRACE_MS` 定数、必要なら後日）。
- 強制休憩後の予約経由での再出場ブロック（管理者が通知を見て運用対応）。
- 対応完了時の自動「待機」復帰（手動でトグルする運用のまま）。
- Undo（自動発火のため Undo スタックには積まない）。

## 確認

- `npm run build` / `npm run lint` / `npm run test:run`
- `sessionMutations.test.ts`: `computeEnforceForcedRest` / `unresolvedOpsOf` /
  `enforceForcedRest`（対象ゼロなら書き込まない）のユニットテスト。
- `useFirebaseSync.test.ts`: 通知の発火・文言の出し分け・重複防止・
  2 分ガードのテスト。
