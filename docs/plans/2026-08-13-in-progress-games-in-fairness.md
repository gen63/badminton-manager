# 進行中の試合を公平性の母集団に数える（effective gamesPlayed）

## 背景 / 問題

`Player.gamesPlayed` は **試合終了時に +1**（`gameOperations.ts` `computeFinishAndContinue`）。
一方で配置アルゴリズムの公平性判定には、**コート上でプレイ中のメンバーも母集団に含む**
箇所がある。結果として次のズレが起きている。

- いま試合を終えた人 … 既に +1 済み
- 同時に別コートで試合中の人 … まだ +1 されていない（実態より 1 少ない）

連続モードは試合終了と同時に次を組むため、まさにこの瞬間に平均・中央値・最大値が
**過小評価**され、「終わったばかりの人」が相対的に試合数の多い人に見えて足切り側へ
倒れやすい。実態としては「配置された時点でその人は1試合こなす」ので、配置済みの
メンバーは +1 として数えるのが正しい。

## 方針（決定事項）

1. **基準は「配置済み」**（`isPlaying` は問わない）。コートに乗った時点で +1 とみなす。
   自動開始が配置+3分で `startedAt = assignedAt` を採用している
   （`2026-08-13-auto-start-after-assign.md`）ため、開始基準と実質差が無く、
   連続モードの「終了と同時に次を配置」に効かせるには配置基準が必要。
2. **保存値は変えない。** Firestore の `gamesPlayed` は今まで通り試合終了時 +1。
   `matchHistory` から導出可能という不変条件（`sessionMutations.ts`
   `recomputePlayerMatchStats`）を維持する。よって**減算・ロールバックは一切不要**
   （手動交換でコートを降りれば次の瞬間から +1 が自然に外れる）。
3. **`lastPlayedAt` は触らない。** これは休憩時間ペナルティ（`algorithm.ts`
   `calculateRestPenalty` 相当）の基準で、試合中に now へ更新すると「待ち時間ゼロ」
   扱いになり意味が変わる。
4. **UI 表示は変えない。** `MainPage` / `PlayerSelect` / `AccountingPage` の
   「N試合」は保存値のまま。今回は内部の公平性のみが対象。
5. 会計・履歴・GAS アップロードは無変更。

## 実装

### 1. ヘルパー（新規 `src/lib/effectiveGames.ts`）

```ts
/**
 * 配置済みコートに乗っているメンバーの gamesPlayed を +1 した配列を返す。
 * 「配置された時点で1試合こなす」とみなし、公平性判定の母集団を実態に合わせる。
 * 保存はしない（Firestore の gamesPlayed は試合終了時 +1 のまま）。
 */
export function withInProgressGames(players: Player[], courts: Court[]): Player[];
```

- 対象集合は「コートの `teamA` / `teamB` に ID が入っている人」（空文字は除外）。
  既存の `playersInCourts` と同じ集合の作り方に揃える。
  `assignedAt` / `isPlaying` は**見ない**（配置解除時にチームが空になるため、
  チームの中身だけで判定するのが最も事故が少ない）。
- 対象外のプレイヤーは**同一オブジェクト参照のまま返す**（不要な再レンダー抑止）。
- 純粋関数。呼び出し側は「渡す直前」に適用する。

### 2. 適用箇所

母集団に**コート上の人が混ざる**呼び出しだけに適用する。待機者リスト
（`waitingPlayers`）はコート外なので適用しても値は変わらないが、取り違え防止のため
**players 配列全体に一度適用してから絞り込む**形に統一する。

| 箇所 | 対象 |
| --- | --- |
| `gameOperations.ts` `computeFinishAndContinue` | `updatedPlayers` に適用してから `allPlayers` / `restingPlayers` / `getCallableReservationRestingIds` へ渡す |
| `MainPage.tsx` `handleAutoAssign`（:514 付近） | `players` に適用してから `waitingPlayers` / `allActivePlayers` / `restingPlayers` を作る |
| `MainPage.tsx` `callableReservedCount`（:680 付近） | `getCallableReservationRestingIds` の第1引数 |
| `nextMatchPrediction.ts` `runScenario` | `players` に適用（`activePlayers` = `allPlayers` 用） |

**最重要の注意点: `computeFinishAndContinue` では必ず `updatedCourts`（対象コートを
クリアした後）を渡すこと。** `state.courts` を渡すと、終了処理で既に +1 された4人に
もう一度 +1 が乗り、二重加算になる。

`nextMatchPrediction.ts` の `simulateFinish` も同様で、戻り値の `courtsAfter` は
チームを空にしているので、そちらを渡す限り二重加算は起きない（`assignedAt` を
消していないため、判定に `assignedAt` を使ってはいけない理由でもある）。

### 3. 実際に効く先（確認事項）

`assignCourts` 内で `gamesPlayed` を読む箇所のうち、今回の変更が効くのは
**`options.allPlayers` / `restingPlayers` を母集団にしている以下**:

- `algorithm.ts` `lateBalance.maxGamesPlayed`（`allPlayers` から max）
- `algorithm.ts` 予約保留判定の `medianGamesPlayed`（`allPlayers + restingPlayers`）
- `algorithm.ts` `getCallableReservationRestingIds` の中央値（在席全員）

`formTeams` 系の「平均 +3 試合の足切り」（`MAX_GAMES_ABOVE_AVERAGE`）は
待機者ベースの母集団なので影響しないはず。**実装時に実際の引数の出所を確認し、
影響範囲が上記と違っていたらこの節を実態に合わせて更新すること。**

`checkContinuousBlock`（`gameOperations.ts`）は人数しか見ないので変更不要。

### 4. テスト

- 新規 `src/lib/effectiveGames.test.ts`
  - コート上のメンバーだけ +1 / コート外は不変 / 空文字 ID を無視 /
    休憩中でもコート上なら +1 / 対象外は同一参照
- `gameOperations.test.ts`
  - 2コートで片方が終了したとき、**もう一方のコートで試合中のメンバーが
    `allPlayers` 上で +1 されて渡る**こと（`maxGamesPlayed` / 中央値の入力）
  - 終了したコートの4人が**二重加算されない**こと（回帰の要）
- 既存テスト（`algorithm.test.ts` / `nextMatchPrediction.test.ts` など）の
  期待値が動く可能性あり。中央値・最大値の閾値比較は整数の `>=` なので境界がずれる。
  **期待値を機械的に書き換えず、動いた理由が上記の意図通りか1件ずつ確認**してから直す。

## 非対象

- `gamesPlayed` の保存タイミング変更、減算処理
- `lastPlayedAt` の変更
- UI 表示（「N試合」）の変更
- 会計・履歴・アップロード
