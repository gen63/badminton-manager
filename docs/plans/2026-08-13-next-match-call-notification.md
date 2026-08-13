# 次の試合の呼び出し通知（試合開始通知の廃止 + 配置予測ベースの事前通知）

- 起票日: 2026-08-13
- ブランチ: `claude/match-notification-timing-d7xyag`

## 背景 / 課題

現在の `notifyMatchStart`（`src/lib/notifications.ts`）は、自分がコートに入って
試合が**始まった後**に届く事後通知で、受け取った時点でやることが無い。

さらに `MATCH_AUTO_START_MS`（配置後3分の自動開始）が効いた場合、`startedAt` は
配置時刻なので「3分前に始まりました」という通知になる。呼び出しとして機能して
いない。

呼び出しは「入る前」にこそ意味がある。配置予測（`src/lib/nextMatchPrediction.ts`）
で次に入るメンバーは事前に算出できているので、そこへ通知を出す。

## 方針

- 試合開始通知は**廃止**する。
- 代わりに「試合の経過時間が閾値を超えたら、配置予測の**ほぼ確定（`certainIds`）**
  メンバーに呼び出し通知」を出す。
- 候補（`likelyIds`）は通知対象にしない。理由: `2026-08-13-next-match-prediction.md`
  の実測どおり出現率100%は3コート稼働・待機10人で平均2人しかおらず、候補まで
  呼ぶと空振りが常態化する。呼び出し通知は空振り1回で信頼を失い以後無視される
  ため、確度の高いメンバーだけに絞る。
- 文言は言い切らない（「入ります」ではなく「入りそうです」）。予測は休憩解除・
  メンバー追加・予約で変わりうるため。
- 自分の試合直後はクールダウンを置く。ほぼ確定に入った瞬間はロジックとしては
  正しくても、コートを降りた直後に鳴ると体感がうるさいため、直後90秒は通知を
  抑制する（根拠は後述）。
- 通知文言には対象コート番号とメンバー名を含める。固定文「次の試合に入りそう
  です。準備してコート脇へお願いします」だけでは、どこへ向かえばいいか・誰と
  組むかが伝わらず行動に移しにくいため。
- **今回はフォアグラウンド前提と割り切る**。バックグラウンドでも届く通知
  （Service Worker + FCM Web Push）は規模が大きいため別課題（issue #305）として
  分離した。
- 通知許可が無いメンバーにも届くよう、Browser Notification に加えてグローバル
  トースト（`useNoticeStore` → `GlobalNotices`）でも出す。既存の強制休憩通知
  （`notifyForcedRest` + `useNoticeStore.getState().show(...)` の二本立て）と同じ形。

## 閾値の根拠（実測データ）

2026-08-11 目白の実測 n=63、うち20分の1件は外れ値として除外（`MATCH_AUTO_END_MS`
が15分なので手動記録の異常値と判断）。有効 n=62。

| 試合時間 | 件数 | 割合 | 累積 |
|---|---|---|---|
| 5分 | 11 | 17.5% | 17.5% |
| 6分 | 20 | 31.7% | 49.2% |
| 7分 | 19 | 30.2% | 79.4% |
| 8分 | 10 | 15.9% | 95.2% |
| 9分 | 2 | 3.2% | 98.4% |

平均 6.55分 / 中央値 6.5分 / p10 5.0分 / p25 6.0分 / p75 7.0分 / p90 8.0分。
**分布が5〜9分と極めて狭い**（σ≒1分）のが重要な事実で、`MATCH_AUTO_END_MS` の
15分は実運用では一度も効いていない。

閾値ごとのシミュレーション:

| 閾値 | 発火率 | リードタイム（通知→試合終了） |
|---|---|---|
| 4分 | 100% (62/62) | 中央 2.5分 / 最大 5分 |
| 5分 | 82% (51/62) | 中央 2.0分 / 最大 4分 |
| 6分 | 50% (31/62) | 中央 1.0分 / 最大 3分 |

**採用: 4分30秒**。理由:

- 6分は半分の試合で通知が出ないので却下。
- 5分は p10 相当で設計として素直（リードタイム中央2分はラケット・ドリンク・
  コート脇への移動に十分で、待たされすぎない）。
- ただし実測記録が**分単位の粗い記録**（丸め）で、「5分」の実体は 4:30〜5:30。
  閾値をきっかり5分00秒にすると記録上5分の11件のうち相当数を直前で取りこぼす。
  4:30 なら発火率はほぼ100%に上がり、リードタイムの増加は+0.5分に留まる。
- なお実質的な取りこぼしは発火率の数字より小さい。通知はコート単位ではなく
  メンバー単位で出すため、**どれか1コートが閾値を超えれば発火**する。2コート
  稼働なら全コートが4:30以内に終わる確率は数%、3コートならほぼゼロ。

## 設計

### 廃止

- `src/lib/notifications.ts` の `notifyMatchStart()` を削除
- `src/hooks/useFirebaseSync.ts` の `checkMatchStartNotifications()`・その呼び出し・
  `notifiedMatches` Set を削除
- `src/hooks/useFirebaseSync.test.ts` の試合開始通知テストを削除
- `notifyForcedRest` 系（会費未払い・結果未登録による強制休憩の通知）は目的が
  違うので**残す**

### 新定数（`src/lib/gameOperations.ts`、`MATCH_AUTO_END_MS` の近く）

```ts
export const MATCH_CALL_THRESHOLD_MS = 4.5 * 60 * 1000;
export const MATCH_CALL_COOLDOWN_MS = 90 * 1000;
```

`MATCH_CALL_THRESHOLD_MS` の根拠は上記の実測データ節に要約して JSDoc コメントに
残す。

`MATCH_CALL_COOLDOWN_MS`（90秒）は自分がコートを降りた直後の連続通知を抑える
ためのもの。降りた直後はまだ物理的にコート脇に居るので呼ぶ必要が無く、鳴っても
うるさいだけ。一方で試合時間は5〜9分に集中している（上記実測）ため、90秒抑制
しても呼び損ねる実害はほぼ無い。

### 新規純関数（`src/lib/nextMatchCall.ts`）

MainPage から副作用を切り離してテスト可能にする。

```ts
export function maxPlayingElapsedMs(courts: Court[], now: number): number
export function shouldCallNextMatch(args: {
  courts: Court[];
  certainIds: Set<string>;
  myPlayerId: string | null;
  now: number;
  alreadyCalled: boolean;
  lastOnCourtAt: number | null;
}): boolean
export function callBasisCourtId(courts: Court[], now: number): number | null
export function buildNextMatchCallMessage(
  courtNumber: number,
  names: string[],
): { body: string; toast: string }
```

`shouldCallNextMatch` が true になる条件（すべて満たすとき）:

1. `myPlayerId !== null`
2. `!alreadyCalled`
3. `certainIds.has(myPlayerId)`
4. 自分がどのコートにも乗っていない
5. `maxPlayingElapsedMs(courts, now) >= MATCH_CALL_THRESHOLD_MS`
6. `lastOnCourtAt === null` または `now - lastOnCourtAt >= MATCH_CALL_COOLDOWN_MS`
   （クールダウン。`lastOnCourtAt` は自分が最後にコートに乗っていた時刻で、一度
   も乗っていなければ `null`）

判定基準を「経過時間が**最大**のコート」にしているのは、それが最初に終わる
可能性が最も高いコートだから。予測の `certainIds` はどのコートが終わっても
選ばれるメンバーなので、どのコートを基準にしても呼ぶ相手は変わらない。

#### 基準コートの決め方（通知文言用）

`certainIds` 自体は特定のコートに紐づかないが、通知文言に「どこで待てばいいか」を
書くために案内先として1コートを選ぶ必要がある。`callBasisCourtId` は
`predictNextMatchPlayers` のシナリオ構成と同じ考え方で決める:

- 空きコートがあれば、そのうち最も ID が小さいコート（このとき予測はそのコートへの
  配置結果で確定している）
- 空きコートが無ければ、経過時間が最大のプレイ中コート（最初に終わる可能性が
  最も高い）
- どちらも該当しなければ通知しない（`null`）

**注記**: 基準コートは「最も早く終わりそうなコート」であって確約ではない。別の
コートが先に終わってもメンバーの選出は変わらない（`certainIds` の性質）ので、
案内するコートが変わりうる点だけが誤差になる。

### 通知本体（`src/lib/notifications.ts`）

```ts
export function notifyNextMatchSoon(body: string): void
```

タイトル「まもなく出番です」／ tag `next-match-soon` は変更なし。文言の組み立ては
純関数側（`nextMatchCall.ts` の `buildNextMatchCallMessage`）の責務にし、
`notifyNextMatchSoon` は受け取った文字列をそのまま表示するだけにする。

`buildNextMatchCallMessage` が返す文言:

- Browser Notification の body: `{N}コート付近で試合終了をお待ちください` + 改行 +
  `Aさん・Bさん`
- グローバルトースト: `{N}コート付近で試合終了をお待ちください（Aさん・Bさん）`
  （1行）

名前の整形は既存の強制休憩通知と同じ `${name}さん` を `・` で連結。名前が空の
ときは名前部分を省く。

### MainPage への組み込み

- `useRef<boolean>` で「呼び出し済み」を保持し、10秒間隔で `shouldCallNextMatch`
  を評価（4:30 という閾値に対して10秒粒度で十分）。
- `lastOnCourtAtRef`（`useRef<number | null>`）で自分が最後にコートに乗っていた
  時刻を保持する。10秒間隔の評価時と、配置リセット用 effect の両方で「自分が
  コートに乗っていれば現在時刻に更新」する。`shouldCallNextMatch` にはこの ref の
  値を `lastOnCourtAt` として渡す。
- true なら `callBasisCourtId` で基準コートを決め、対象メンバー名を画面の配置
  予測バーと同じ並び（`predictedPlayers` を `certainIds` で絞ったもの）で取得し、
  `buildNextMatchCallMessage` で文言を組み立てて Browser Notification とグローバル
  トーストの両方を出し、ref を true にする。基準コートが取れない
  （`callBasisCourtId` が `null`）場合は通知しない。
- リセット条件は「**自分がいずれかのコートに配置されたとき**」のみ。予測から
  外れただけではリセットしない（予測のブレで何度も呼ばれるのを防ぐ）。

## テスト

`src/lib/nextMatchCall.test.ts` を新規作成し、`shouldCallNextMatch` の各条件を
網羅（閾値未満／以上、`certainIds` に居ない、既に呼び出し済み、自分がコート上に
居る、プレイ中コートが無い、など）。加えて以下を追加した:

- クールダウン: `lastOnCourtAt` が閾値時間内／経過後／`null` の3パターン
- `callBasisCourtId`: 空きコート優先・空きコートが複数ある場合は最小 ID・空き
  コートが無い場合は経過時間最大のコート・経過時間が同着の場合は ID が小さい方・
  準備中コートは対象外・該当コートが無い場合は `null`
- `buildNextMatchCallMessage`: 名前ありのときの body / toast、名前が空配列の
  ときの body / toast（名前部分を省いた文言になること）

## 変更ファイル

- `src/lib/notifications.ts` — `notifyMatchStart` 削除 / `notifyNextMatchSoon(body)` 追加
- `src/lib/gameOperations.ts` — `MATCH_CALL_THRESHOLD_MS` / `MATCH_CALL_COOLDOWN_MS` 追加
- `src/lib/nextMatchCall.ts`（新規）— `maxPlayingElapsedMs` / `shouldCallNextMatch` /
  `callBasisCourtId` / `buildNextMatchCallMessage`
- `src/lib/nextMatchCall.test.ts`（新規）
- `src/hooks/useFirebaseSync.ts` — `checkMatchStartNotifications` / `notifiedMatches` 削除
- `src/hooks/useFirebaseSync.test.ts` — 試合開始通知テストの削除
- `src/pages/MainPage.tsx` — 10秒ポーリングでの呼び出し判定（クールダウン込み）・
  基準コート/メンバー名からの文言組み立て・通知発火・リセット

## 想定される制約 / 今後

- フォアグラウンドの端末にしか届かない（issue #305 で対応）。
- 閾値は固定値だが、将来 `matchHistory` の実測から動的に決める余地がある。

## 完了条件

- `npm run build` / `npm run lint` / `npm run test:run` すべて通過
