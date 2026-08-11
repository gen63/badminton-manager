# オートセッション自動作成の失敗対策（リトライ / 失敗通知 / 破壊的同期の防止）

## 背景

「オートセッションが時々失敗する」という報告を受け、GitHub Actions
`Auto Create Session` の直近2ヶ月分の実行ログを実測した。失敗は6件で、
原因は2種類に分かれた。

| 日付 | 原因 |
| --- | --- |
| 2026-06-29 / 07-06 / 08-10 | `UND_ERR_CONNECT_TIMEOUT`（E-ToMo への接続タイムアウト） |
| 2026-07-20〜07-23（4連続） | `import.meta.env` が undefined（`07f8319` で修正済み・再発なし） |

現在も残っているのは前者。ログの実体は次の通り:

```
E-ToMo fetch error: TypeError: fetch failed
  [cause]: ConnectTimeoutError: Connect Timeout Error
           (attempted address: system.hawai-an.com:443, timeout: 10000ms)
Fatal error: Error: E-tomoイベント一覧の取得に失敗しました
```

E-ToMo（`system.hawai-an.com`）が数分だけ接続不能になることがあり、
`fetchEtomoPage` は**単発の fetch・リトライ無し**だったため、undici の
接続タイムアウト（既定10秒）でそのまま fatal 終了していた。一過性である
ことは 2026-08-10 の失敗（21:47）が同日 23:09 の手動再実行で成功している
ことからも裏付けられる。

さらに調査中に、同じ「E-ToMo が不安定」という原因から**より深刻な結果**を
生む経路が見つかった。`fetchEventDetails` はイベント詳細ページの取得に
失敗すると `participants: []` のダミーを返しており、これは「参加者0名」と
区別が付かない:

- 新規イベント → **参加者0名のセッションを作成**する
- 既存セッションあり → ロースター同期の差分計算で **登録メンバーが全員削除**される

いずれも Discord には成功として通知されるため、気づきにくい。

## 対応方針

「失敗しても自力で復旧する」「復旧できなければ黙って壊さず気づける」の2点に絞る。
E-ToMo 側は変更できないので、こちら側の耐性と可視性を上げる。

### 1. リトライ付き fetch を共通化する（`scripts/auto-create-session.ts`）

`fetchWithRetry(url, init, label, delaysMs)` を追加し、外部への fetch を全て置き換える。

- バックオフ `RETRY_DELAYS_MS = [3000, 8000, 20000, 45000]`（5回試行・待機合計約76秒）
- 1回の試行に `AbortSignal.timeout(30000)`
- 再試行対象は例外（接続タイムアウト等）と 408/425/429/5xx。4xx はそのまま返して
  呼び出し側に判断を委ねる
- 全試行が失敗したときのみ throw。`describeError` で undici の `cause` まで1行に含める

適用先: E-ToMo 一覧・詳細（`fetchEtomoPage`）、GAS の `createTmpSheet` /
`readTmpSheet`、Discord webhook（`sendDiscordMessage`）。
GAS 呼び出しに個別に書かれていた `AbortSignal.timeout(30000)` はヘルパーに集約する。

### 2. 詳細取得の失敗を「参加者0名」と混同しない

`fetchEventDetails` の戻り値を `{ details, failed }` に変更する。
取得できなかったイベントは `failed` に分離し、`details` には入れない。

`main` 側:
- `failed` があれば Discord に警告（そのイベントは未処理である旨）
- 対象イベントの詳細が**全滅**した場合は throw してジョブを失敗させる
  （成功扱いで終わらせない）

### 3. 参加者0名での同期をスキップする（多層防御）

`processEvents` の既存セッション分岐で、`event.participants.length === 0` なら
ロースター同期を行わず Discord に警告する。2 で主因は塞がるが、
「全員削除」は取り返しがつかないので入口でも止める。

### 4. 失敗を Discord に通知する

これまで fatal error 時は GitHub Actions の失敗メールしか手掛かりが無く、
誰も気づかないまま練習当日を迎える恐れがあった。`main().catch` で
`notifyFatalError` を呼び、エラー要約と手動再実行の案内を流す。
通知自体が失敗しても終了コードは 1 のままにする。

### 5. ワークフローのタイムアウト延長

`.github/workflows/auto-session.yml` の `timeout-minutes` を 5 → 15。
リトライ込みで1リクエスト最大約2分待つため、複数イベントでも収まるようにする。

## 対象ファイル

- `scripts/auto-create-session.ts` — 上記1〜4
- `scripts/auto-create-session.test.ts` — テスト追加
- `.github/workflows/auto-session.yml` — `timeout-minutes`

## 検証

```bash
npm run build && npm run lint && npm run test:run
```

追加したテスト:

- `fetchWithRetry` — 接続タイムアウト後の再試行で成功 / 全試行失敗で原因付き throw /
  5xx は再試行 / 4xx は再試行せず返す / init（method・body）を保ったまま再試行
- `describeError` — undici の `cause` を含めて1行にまとめる
- `fetchEventDetails` — 1件成功・1件失敗のとき、成功分だけ `details` に入り
  失敗分は `failed` に分離される（`participants: []` のダミーを作らない）
  ※ バックオフを実時間で待たないよう `vi.useFakeTimers()` + `runAllTimersAsync()` を使う

実地確認は GitHub Actions の `Auto Create Session` を `workflow_dispatch` で
手動実行し、Discord に通常どおり通知が届くことを見る。

## 採用しなかった案

- **予備 cron の追加（06:30 / 07:00 にも実行）** — E-ToMo が数十分ダウンしても
  救えるが、成功時に「同期済み（変更なし）」通知が毎日増えて騒がしい。
  抑制フラグを足すと複雑になるため、まずはスクリプト内リトライ＋失敗通知で様子を見る。
  実績上はこれで復旧するはずで、足りなければ後から追加する。
- **undici `Agent` で接続タイムアウト自体を延長** — 10秒→30秒などにできるが、
  `undici` への直接依存が増える。失敗は「遅い」ではなく「一時的に繋がらない」
  ため、リトライの方が効く。
