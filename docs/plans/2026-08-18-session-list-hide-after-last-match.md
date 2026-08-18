# セッション一覧: 最後の試合終了から30分で非表示

## Context

現在の `isSessionVisible()`（`src/lib/sessionArchive.ts:22`）は、試合が始まったセッションを
**最初の試合開始から 12 時間**表示し続ける。3 時間の練習なら終了後も 9 時間（翌朝まで）
一覧に残り続けるため、古いセッションが一覧を占有する。

これを **「最後の試合が終わってから 30 分」** に変える。基準点が固定タイマー（最初の試合開始）
から、試合のたびに延長されるタイマー（最後の試合終了）に変わるので、長時間の練習でも
途中で消えることがなくなる一方、練習後は速やかに一覧から消える。

ユーザー確認済みの前提:
- 休憩などで無試合が 30 分続いても、**コートに試合が進行中なら表示**する。
- 「想定練習時間」は新規フィールドが必要になるので**持たない**（`SessionConfig` に該当データなし）。
- 練習直後に一覧から消えることは dev モードで全件見えるので許容。
- `finishedAt` のクライアント時計ずれは実運用上無視できる。
- 閾値は 30 分。

## 判定ロジック（変更後）

```
firstMatchStartedAt あり（試合開始済み）:
  1. firstMatchStartedAt <= now - 12h        → 非表示（絶対上限・据え置き）
  2. コートに試合が進行中                     → 表示
  3. lastMatchFinishedAt が無い（旧データ）   → 表示（従来の 12h 判定にフォールバック）
  4. lastMatchFinishedAt > now - 30min       → 表示 / それ以外は非表示

firstMatchStartedAt なし（試合未開始）: 変更なし
  - now < practiceStartTime - 90min          → 非表示
  - practiceStartTime の日付が今日以降        → 表示
```

### 進行中ガードと 15 分自動終了の関係

`MATCH_AUTO_END_MS`（15 分、`src/lib/gameOperations.ts:18`）の自動終了があるため、
進行中ガードが実際に効くのは次の 2 ケースに絞られる（休憩そのものの間はコートが空なので、
ガードの有無にかかわらず一覧からは消える）:

- 30 分以上の休憩明けに再開したとき、**その試合の終了を待たず即座に一覧へ復帰**できる。
- 自動終了は `MainPage` の `setTimeout` で動くクライアント常駐処理
  （`src/pages/MainPage.tsx:286-300`）なので、**誰もセッション画面を開いていない間は発火しない**。
  その状態で試合中のまま 30 分経つケースの保険になる。

12h の絶対上限を残すのは、上記 2 番目の裏返しで、**「試合終了」を押さずに解散して
コートが進行中のまま残ったセッションが永久に一覧に居座る**のを防ぐため。

## 実装方針: 非正規化はしない

`firstMatchStartedAt` はトップレベルに非正規化されているが、今回は不要。
`docToSession`（`src/services/sessionService.ts:127`）は既に `data.gameState` を展開して
`matchCount` / `paidCount` / `medianGamesPlayed` を算出しており、`matchHistory` と `courts` は
一覧購読のスナップショットにそのまま入っている（2026-04-17 plan の「gameState を展開しない」
という前提は現在は成立していない）。

よって **`docToSession` の派生フィールドとして計算する**。書き込み経路
（`buildGameStatePayload` / `syncGameState` / `createSession`）の変更は不要で、
既存ドキュメントにも即座に効く（マイグレーション不要）。

## 変更内容

### 1. `src/lib/sessionArchive.ts`

- `export const VISIBLE_AFTER_LAST_MATCH_MS = 30 * 60 * 1000;` を追加。
- 純粋関数を 2 つ追加:
  - `computeLastMatchFinishedAt(matches: Match[]): number | null`
    — `finishedAt > 0` のものだけを対象に `Math.max`。該当なしは `null`。
  - `computeHasActiveCourt(courts: Court[]): boolean`
    — `c.isPlaying || !!c.teamA?.[0]`。配置直後で「開始」未押下のコートも進行中扱いにする
    （`src/lib/gameOperations.ts:97` の `occupied` と同じ判定基準に合わせる）。
- `isSessionVisible` の引数型に `lastMatchFinishedAt?: number | null` と
  `hasActiveCourt?: boolean` を追加し、`firstMatchStartedAt` あり分岐を上記ロジックに差し替え。
  未開始分岐は無変更。

### 2. `src/types/session.ts`

`Session` の「一覧表示用の派生フィールド」セクションに追加:
- `lastMatchFinishedAt?: number | null;`
- `hasActiveCourt?: boolean;`

### 3. `src/services/sessionService.ts`

`docToSession` 内のローカル `gameState` 型に `matchHistory?: Match[]` /
`courts?: Court[]` を持たせ（現在 `matchHistory?: unknown[]`）、返却オブジェクトに
`lastMatchFinishedAt` と `hasActiveCourt` を追加。`matchCount` は既存のまま。

### 4. `src/pages/SessionSelectPage.tsx`

ロジック変更なし（60 秒 tick で `isSessionVisible(session, now)` を再評価する既存の仕組みが
そのまま 30 分判定にも効く）。`// dev モードは全件、それ以外は isSessionVisible で
90分前 / 12h アーカイブ判定` のコメントだけ実態に合わせて更新。

### 5. `src/lib/sessionArchive.test.ts`

- `computeLastMatchFinishedAt`: 空配列 / `finishedAt=0` のみ / 複数の max（順不同）。
- `computeHasActiveCourt`: 空 / `isPlaying: true` / 配置済み `isPlaying: false` / 全部空。
- `isSessionVisible` の 12h 判定 describe に境界ケースを追加:
  - 最後の試合終了が 29 分前 → 表示 / ちょうど 30 分前 → 非表示（厳密 `>`）/ 31 分前 → 非表示
  - 最後の試合終了が 3 時間前でも `hasActiveCourt: true` なら表示
  - `hasActiveCourt: true` でも `firstMatchStartedAt` が 12h 超なら非表示
  - `lastMatchFinishedAt` 未設定（旧データ）は従来どおり 12h 判定
- 既存テストは互換のまま通ることを確認（`lastMatchFinishedAt` を渡していないケースは
  フォールバックで従来の期待値を維持する）。

### 6. ドキュメント

- `docs/plans/2026-08-18-session-list-hide-after-last-match.md` に本 plan をコミット。
- `docs/plans/INDEX.md` に 1 行追記。

## 検証

```bash
npm run build && npm run lint && npm run test:run
```

手動確認（dev モードを切って一覧を見る）:
1. 試合を 1 回終わらせたセッションが一覧に出る → 30 分放置で消える。
2. コートに試合を配置したまま 30 分超 → 消えない。
3. 試合未開始のセッションは従来どおり（開始 90 分前から当日中まで表示）。
4. 古い既存セッション（`courts` がまだ埋まっている等）で意図せず残り続けないこと。
5. dev モードでは全件見えること（既存挙動）。
