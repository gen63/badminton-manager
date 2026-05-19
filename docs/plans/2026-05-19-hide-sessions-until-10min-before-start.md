# セッション一覧: 開始10分前まで非表示

## 背景

現状 `isSessionVisible()`（`src/lib/sessionArchive.ts`）は「試合未開始」セッション
について **日付** 単位で `practiceStartTime >= 今日` を判定しているため、
たとえば 19:00 開始のセッションでも当日 0:00 から一覧に表示される。

ユーザー要望:
> セッション一覧を、規定の時間を迎えるまで見えないようにしたい。
> 判定基準は「開始10分前」、一覧に出ないだけ（直接URLでは参加可能）、
> 開発モードは関係なく表示。

## 方針

`isSessionVisible()` に **下限** ルールを追加する:

- `now < practiceStartTime - 10分` → 非表示（早すぎる）
- それ以上の時刻 → 既存ロジックに従う

既存の上限（`practiceStartTime` の日付が過ぎたら非表示）はそのまま維持する。

`firstMatchStartedAt` がある場合（既に試合開始済み）は既存の 12h 判定のみで
判断する。10分前ルールは「未開始」ケースのみに適用。

### 開発モード

`subscribeToRecentActiveSessions` は `includeArchived` のとき
`isSessionVisible` フィルタを丸ごとスキップする実装 (`sessionService.ts:393`)。
`SessionSelectPage` は `includeArchived: devMode` を渡しているため、
**dev モードでは 10 分前ルールも自動的にバイパスされる**。追加変更不要。

### URL 直接アクセス

`isSessionVisible` は一覧の購読フィルタ
(`subscribeToRecentActiveSessions`) でのみ使われており、
`/session/:id` の読み込みでは判定していない。よって URL を知っている
ユーザーは引き続きセッションに直接アクセスできる（要望通り）。

### 自動更新（非対応）

`onSnapshot` ベースの購読のため、開始 10 分前ちょうどに一覧が
ライブ更新されるわけではない。リロードか次の Firestore 変更で反映される。
要件「一覧に出ない」だけ満たせばよいので、ティッカーは入れない。

## 変更内容

### `src/lib/sessionArchive.ts`

- 新規定数 `VISIBLE_BEFORE_START_MS = 10 * 60 * 1000` を export
- `isSessionVisible` の `firstMatchStartedAt` なし分岐に、
  `now < startTime - VISIBLE_BEFORE_START_MS` のとき `false` を返すガードを追加

### `src/lib/sessionArchive.test.ts`

- 「10分前ちょうど」「10分1秒前」「9分59秒前」「開始時刻」「開始後」
  などの境界テストを追加

## 影響範囲

- `SessionSelectPage` の一覧: 開始10分前まで非表示に
- `SessionJoinPage` (`/session/:id`): 影響なし（直接アクセス可）
- dev モード一覧: 変更なし（全件表示のまま）
