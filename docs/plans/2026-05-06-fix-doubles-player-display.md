# ダブルス練習でコートに 2 人しか配置されない不具合の修正

作成日: 2026-05-06
対応ブランチ: `claude/fix-doubles-player-display-mEvx6`

## 不具合

ユーザー報告:
> ダブルスで試合をしているのに、2 人しか配置されない、シングルになることがある。
> 予約を使った直後？

ダブルスとして練習しているはずなのに、コートが「片チーム 1 人 vs 片チーム 1 人」
（teamA = `[a, '']`、teamB = `[b, '']`）になる。予約消化のタイミングで起きやすい。

## 原因

### 1. 端末ローカルの `practiceType` が前セッションから持ち越されて不整合

- `gameMode` は `MainPage.tsx` で
  `gameModeFromPracticeType(useSettingsStore((s) => s.practiceType))` から導出する。
- `useSettingsStore` は `persist` で localStorage に保存される（端末ローカル）。
- `useFirebaseSync` は `gameState.settings.practiceType` が **defined のときのみ**
  `setPracticeType` を呼ぶ実装だった (line 189-194)。
- 旧セッション等で `gameState.settings.practiceType` が未定義の場合、ユーザー前回
  使った `'単'` が localStorage に残っていると、ダブルス意図のセッションでも
  `gameMode = 'singles'` のまま `assignCourts` が呼ばれる。
- シングルスフローの 2 人予約は `teamA = [a, ''], teamB = [b, '']` を作って
  「予約消化」と記録する。ユーザーから見ると「ダブルスのはずなのに 2 人だけ
  配置された / シングルになった」になる。

### 2. `CourtCard` が teamA[0] のみで判定して残ったプレイヤーを隠す

- `CourtCard.tsx` は
  `court.teamA[0] ? 描画 : <EmptySlots />` でチーム A 全体を出し分けていた。
- 何らかの理由で `teamA = ['', 'B']` になった場合（例: コート上のプレイヤーが
  `computeRemovePlayer` で削除される）、teamA[1] の `B` が描画されない。
- `hasPlayers = court.teamA[0] || court.teamB[0]` も同様に teamA[1]/teamB[1] を
  見ないので、teamA = `['', 'B']`、teamB = `['', '']` の場合はコート全体が
  「未配置」で描画される。

## 修正

### 1. `src/hooks/useFirebaseSync.ts`

`gameState.settings.practiceType` 未定義時の fallback を追加:

```ts
const remotePracticeType = gameState.settings?.practiceType;
const desiredPracticeType: '単' | '複' | '楽' =
  remotePracticeType ??
  (data.config?.gameMode === 'singles' ? '単' : '複');
if (desiredPracticeType !== s.practiceType) {
  s.setPracticeType(desiredPracticeType);
}
```

優先順位:
1. `gameState.settings.practiceType` （新セッションは必ず set される）
2. `session.config.gameMode` （旧セッションの legacy フィールド）
3. `'複'` （最終フォールバック。練習種別の既定値）

これで前セッションの `'単'` が localStorage に残っていても、新セッション参加時に
セッションの意図に揃えられる。

### 2. `src/components/CourtCard.tsx`

- `hasPlayers` を全 4 スロット OR で判定。
- チーム A / B の描画はスロット毎に `<PlayerPill>` を出し、`playerId` が空文字
  なら PlayerPill が空プレースホルダを返す既存挙動に乗せる。

これでプレイヤー削除等で `['', 'B']` になっても残りのプレイヤーが見える。

## 動作確認

- `npm run build` / `npm run lint` / `npm run test:run` がすべて通ること
- `useFirebaseSync.test.ts` に追加した 2 ケース:
  - settings 自体が無く config.gameMode も無い場合 → 端末ローカル `'単'` が `'複'` に矯正される
  - settings 無しでも config.gameMode='singles' なら `'単'` を採用する
- 既存の practiceType 反映テスト (3 ケース) はそのまま通る

## 追加で見つかった関連バグの修正

### 3. `MainPage.handlePlayerTap` の異コート間スワップが非アトミック (CON5)

- 旧実装は `await writer.updateCourt(courtA, ...) → await writer.updateCourt(courtB, ...)`
  を sequential に呼んでいた。
- 1 回目成功 / 2 回目失敗時に **同じプレイヤーが両コートに乗る不整合** が発生。
- リモートが間に変わるとローカルから読んだ teamA/teamB を上書きし、他端末の
  スワップを巻き戻すレースもあった。
- 同一コート内のスワップも同様に「ローカル read → write」でレース耐性が無かった。

**修正**: `sessionMutations.swapPositions(posA, posB)` を新設。1 transaction で
リモート最新を読み、同一/異コート両方をアトミックにスワップする。
`MainPage.handlePlayerTap` から `updateCourt × 2` を `swapPositions × 1` に置換。
`useSessionWriter` にも露出。

### 4. ダブルス予約フローの defensive guard

`assignCourts` ダブルス分岐は `remainingCourtIds.shift()` を type 判定より先に
呼んでいたため、`rsvPlayerIds.length` が 1〜4 の想定外（5 人以上 / 0 人）の
予約が存在すると **コートを 1 つ "失う"** バグがあった（push せず fulfilled
だけ立つ）。`ReservationAddModal` は 2〜4 に制限するため UI からは到達しないが、
旧データ / 直接 Firestore 編集等の異常パスへの保険として、
`length < 1 || length > 4` の予約は shift する前に skip する guard を追加。

## 非対象

- `assignCourts` のダブルスフロー本体（1〜4 人予約）は正常動作のため変更しない。
- 予約消化ロジック (`autoAssignAndFulfill` / `computeFinishAndContinue`) も無変更。
- `prioritizeDiversity` は意図的に端末ローカル（同期しない）。`practiceType` の
  `'単'/'楽'` 切替時に派生して矯正されるので、同期 hub からの drift は無い。
- localStorage の persist 廃止までは行わない (`settingsStore` は端末ローカル設定が
  混ざるため persist 維持）— 同期ポイントだけ強化。
- シングルスモードで 3〜4 人予約が silently 無視される問題は別 plan
  （UX として ReservationAddModal で max を 2 に絞る等の対応）。
