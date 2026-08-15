# 管理者向けの呼び出しアナウンス

## 背景

事前呼び出し通知（`2026-08-13-next-match-call-notification.md` 以降）は、次の試合の
「ほぼ確定」メンバー**本人**にだけ 4 分 30 秒で届く。しかし本人が気づかず動いて
いないケースは残る。

そこで **30 秒遅れの 5 分**で、管理者（作成者＋管理者）に「誰がもうすぐ試合か」を
アナウンスする。管理者はそれを聞いてコート周りを見渡し、まだ動いていない人がいれば
口頭で促す。アプリは「誰が対象か」を伝えるところまでを担い、実際の促しは人が行う。

**「移動したかどうか」はアプリからは検知できない**（コートに乗るまで状態は変わらない）。
検知しようとせず、時間差で情報を渡すだけに徹する。

## 動作

| | 対象 | 閾値 | 内容 |
|---|---|---|---|
| 既存（本人向け） | 「ほぼ確定」メンバー本人 | 4:30 | 太郎さん、花子さん。3コート付近で試合終了をお待ちください |
| 新規（管理者向け） | `isAdmin()` が真の人 | 5:00 | 太郎さん、花子さん、もうすぐ3コートで試合です |

`isAdmin()` は作成者と管理者の両方を含む（＝「管理者以上」）。

## 発火条件

`shouldAnnounceToAdmin()` を `src/lib/nextMatchCall.ts` に純粋関数として置く。
既存の `shouldCallNextMatch()` と同じ流儀（副作用なし・判定だけ）。

すべて満たすときに真:

1. `isAdmin` が真
2. 端末設定 `adminMatchCallAnnounce` が ON
3. まだこの試合サイクルでアナウンスしていない（後述のキーで判定）
4. 「ほぼ確定」メンバーが 1 人以上いる
5. **自分が「ほぼ確定」メンバーに含まれていない**
6. **対象メンバーのうち 1 人以上がまだどのコートにも乗っていない**
7. プレイ中コートの経過時間の最大値が `MATCH_CALL_ADMIN_THRESHOLD_MS`（5 分）以上

### 条件 5 の理由

管理者自身が呼ばれている場合、4:30 に本人向け通知を受け取っており、すでに動いて
いるはず。30 秒後に再び鳴らすと同じ人の端末が 1 サイクルに 2 回鳴って煩わしい。
自分が対象のときは管理者向けを抑制する。

### 条件 6 の理由

5:00 の時点で既に次の試合が始まっていれば（対象メンバーが全員コート上）、促す
相手がいないのでアナウンスする意味がない。

## 重複防止のキー

`alreadyAnnounced` の判定は**プレイ中コートのうち経過時間が最大のコート**の
`id` と `startedAt` を組にしたキー（`` `${id}:${startedAt}` ``）で行う。
このコートが閾値の基準そのものだから、その試合が終わって次が始まれば
`startedAt` が変わり、自然に次のサイクルのアナウンスが解禁される。

**単純な boolean フラグ＋「経過時間が閾値未満になったらリセット」では駄目**。
2 面運用でコート A のアナウンス後に A が終わって次が始まっても、コート B の経過が
5 分を超えたままだと最大値が閾値未満に落ちず、フラグがリセットされない。

そのため `maxPlayingCourt(courts, now): Court | null` を `nextMatchCall.ts` に
追加し、`maxPlayingElapsedMs` と実装を共有する。

## 文言

`buildAdminMatchCallMessage(courtNumber: number | null, names: string[])` を
`nextMatchCall.ts` に追加し、`{ toast, speech }` を返す。既存の
`buildNextMatchCallMessage` と同じく文言の組み立てを 1 箇所に集約する。

- コート番号あり:
  - toast: `太郎さん・花子さんがもうすぐ3コートで試合です`
  - speech: `太郎さん、花子さん、もうすぐ3コートで試合です`
- コート番号なし（1 面運用）:
  - toast: `太郎さん・花子さんがもうすぐ試合です`
  - speech: `太郎さん、花子さん、もうすぐ試合です`

`courtNumber` の `null` 判定は既存と同じ（`2026-08-14-single-court-message.md`）。
呼び出し側が `courts.length <= 1` で決める。

speech 側の名前は `sanitizeNameForSpeech` を通す（記号・絵文字の除去と `外部`
接頭辞の除去）。toast 側は表示なので加工しない。既存の読み上げと同じ方針。

`selfName` の先頭寄せは**しない**。条件 5 により自分は対象に含まれないため。

## 出す通知の種類

**トースト＋音・振動・読み上げのみ。OS 通知は出さない。**

管理者はアプリを開いて進行を見ている前提であり、OS 通知まで出すと本人向け通知と
区別が付きにくくなる。判定は `MainPage` の `setInterval` なのでアプリを開いて
いる間しか動かず、OS 通知を足しても届く範囲は広がらない。

音・振動・読み上げは既存の `fireMatchCallAlert()` をそのまま使う。したがって
**ヘッダーのベル（`matchCallAlert`）が OFF ならトーストだけ**になる。鳴り物の
総元締めはベル 1 つ、という既存方針を崩さない。

## 設定

`settingsStore` に `adminMatchCallAnnounce: boolean`（デフォルト `true`）を追加し、
`partialize` に含めて**端末ローカルに persist** する。**Firestore 同期はしない。**

「自分の端末が鳴るか」の設定であり、管理者が複数いる場合に各自で切れる必要がある。
セッション共通にすると 1 人が切った途端に全管理者が鳴らなくなる。

新規キーなので旧 localStorage には存在せずデフォルトが入る。version bump と
migrate は不要。

### UI

`SettingsPage` に新規カードとして追加する。**「管理者」バッジを付けて管理者用の
設定であることを明記する**（既存の「リセット」カードと同じバッジ様式）。
併せて端末ローカル設定であることも書く。

設定画面自体が非管理者には見えない（`MainPage` の歯車が `isAdmin()` で囲まれ、
`SettingsPage` も非管理者を `/main` へリダイレクトする）ため、置き場所として整合する。
ヘッダーのベルが全メンバー向けなのに対し、こちらは管理者専用なので設定画面が正しい。

## 実装箇所

- `src/lib/gameOperations.ts` — `MATCH_CALL_ADMIN_THRESHOLD_MS = 5 * 60 * 1000` を追加
- `src/lib/nextMatchCall.ts` — `maxPlayingCourt()` / `shouldAnnounceToAdmin()` /
  `buildAdminMatchCallMessage()` を追加
- `src/stores/settingsStore.ts` — `adminMatchCallAnnounce` を追加
- `src/pages/SettingsPage.tsx` — 管理者バッジ付きのトグルカードを追加
- `src/pages/MainPage.tsx` — 既存の呼び出し判定と同じ `useEffect`（10 秒間隔）内で
  管理者向けも評価する。アナウンス済みキーは `useRef` で保持

## スコープ外

- 「移動したかどうか」の検知（不可能）
- 管理者向けの OS 通知
- アナウンスの繰り返し・エスカレーション（1 試合サイクル 1 回のみ）
- 閾値（4:30 / 5:00）を UI から変更する機能

## テスト

`src/lib/nextMatchCall.test.ts`:

- `shouldAnnounceToAdmin` — 非管理者で false / 設定 OFF で false / 5 分未満で false /
  5 分以上で true / 自分が対象なら false / 対象が全員コート上なら false /
  対象が 0 人なら false / 同じキーでアナウンス済みなら false
- `maxPlayingCourt` — プレイ中コートが無ければ null / 経過最大のコートを返す /
  同着なら ID の小さい方
- `buildAdminMatchCallMessage` — コート番号あり/なしの toast・speech /
  speech 側だけ `外部` と記号が除去されること / toast は無加工であること
