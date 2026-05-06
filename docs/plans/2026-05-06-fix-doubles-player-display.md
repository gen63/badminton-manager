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

## 非対象

- `assignCourts` のダブルスフロー自体は正常動作しているため変更しない。
- 予約消化ロジック (`autoAssignAndFulfill` / `computeFinishAndContinue`) も無変更。
- localStorage の persist 廃止までは行わない (`settingsStore` は端末ローカル設定が
  混ざるため persist 維持）— 同期ポイントだけ強化。
