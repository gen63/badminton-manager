# 待機時間（滞在時間）優先モードが実質効いていない問題の修正

- 起票日: 2026-08-11
- ブランチ: `claude/standby-mode-check-h5lmgi`

## 背景・課題

ユーザー報告:
> 待機時間モードが正しく効いていないように思う

調査の結果、**独立した 2 つの原因**が見つかった。

### 原因 1: 連続配置経路に `practiceStartTime` が渡っていない（バグ）

`computeFinishAndContinue`（`src/lib/gameOperations.ts`）が `assignCourts` を呼ぶとき
`practiceStartTime` を渡していない。`assignCourts` は

```ts
const practiceStartTime = options?.practiceStartTime ?? Date.now();
```

でフォールバックするため、この経路では `practiceStartTime === now` になる。すると
`resolveStayStart` が

```ts
Math.max(practiceStartTime /* = now */, opsCompletedAt) // → 常に now
```

を返し、**全員の滞在時間が下限 `MIN_STAY_MINUTES`(5分) に潰れる**。優先スコアは
全員 `gamesPlayed / 5` となり、試合回数モード（`gamesPlayed * 0.4`）と順序が完全に
一致する。＝**待機時間モードが no-op**。

影響範囲:

| 経路 | `practiceStartTime` | 待機時間モード |
| --- | --- | --- |
| 待機者一覧の表示順 `MainPage.tsx:320` | 渡している | 効く |
| 手動「自動配置」ボタン `MainPage.tsx:432` | 渡している | 効く |
| **試合終了時の連続配置** `gameOperations.ts:221` | **渡していない** | **効かない** |

`continuousMatchMode` は既定 ON のため、実運用の配置のほとんどが壊れた経路を通る。
結果、「一覧では A が先頭なのに、試合が終わると B がコートに入る」という食い違いが
起きる（ユーザーの体感と一致）。

`computeOneGameDelta(practiceStartTime, true)` も同じ経路で `1/5` に固定され、
後半均等化モードのペナルティ倍率が本来（`1/経過分`）から外れる。

`git log -S` で確認したところ、この経路には最初から `practiceStartTime` が
渡されていない（`2026-03-15-idempotent-finish-game.md` の設計時点での漏れ）。
2026-08-11 の `opsCompletedAt` 起点化（`2026-08-11-stay-start-at-ops-complete.md`）は
原因ではないが、本修正で初めてその意図が連続配置に効くようになる。

#### 実測（12人1コート / 在席120分・8試合の8人 vs 20分前に来た3試合の4人）

```
practiceStartTime あり  待機時間: OLD0,OLD3,OLD1,OLD2   ← 長く居る人を優先（正しい）
practiceStartTime あり  試合回数: NEW0,NEW3,NEW1,NEW2
practiceStartTime なし  待機時間: NEW0,NEW3,NEW1,NEW2   ← 試合回数モードと同一（バグ）
practiceStartTime なし  試合回数: NEW0,NEW3,NEW1,NEW2
```

### 原因 2: `useStayDurationPriority` が端末ローカル設定（設計の取り残し）

`settingsStore` の `partialize` で localStorage に persist されるだけで、Firestore に
同期されていない。しかし配置モードは**セッション全体の挙動**であり、

- 「試合終了」を押した端末の設定で連続配置のモードが決まる
- 「自動配置」を押した端末の設定で手動配置のモードが決まる
- 待機者一覧の表示順は各端末の設定でバラバラに見える

という状態になる。SessionCreate / SettingsPage に選択 UI がある以上ユーザーは
セッション設定と認識するが、実体は端末ごとの好み。幹事が「試合回数」に切り替えても
他のメンバーの端末は既定の「待機時間」のままなので、誰が操作したかでモードが変わる。

`practiceType` / `continuousMatchMode` / `recordScores` は
`2026-05-06-settings-persist-narrowing.md` で Firestore 同期へ移したが、
`useStayDurationPriority` は「端末ローカルのクセ」と判断して残していた。上記のとおり
セッション単位で揃うべき設定なので、この判断を覆す。

## 仕様

### 原因 1 の修正

`practiceStartTime` はセッション設定（`sessions/{id}.config.practiceStartTime`）であり、
クライアントの状態ではない。`finishMatchAndContinue` の transaction は既に
`sessions/{id}` の snapshot を読んでいるので、**同じ snapshot の `config` から読んで**
`computeFinishAndContinue` へ渡す（追加の read は不要）。クライアントから
`FinishGameOptions` で受け取る形にはしない（リモートを真実のソースにする方針に従う）。

`config.practiceStartTime` が欠損している異常系は `Date.now()` にフォールバックする
（現状と同じ挙動＝退行しない）。

### 原因 2 の修正

`useStayDurationPriority` を Firestore 同期設定 (`SyncSettings`) へ移す。
`continuousMatchMode` / `lateBalanceMode` と同じパターンに揃える。

- `SyncSettings.useStayDurationPriority?: boolean`
- 旧セッション互換の既定値は **`true`**（`settingsStore` の初期値・`assignCourts` の
  `?? true` と一致させる）。`continuousMatchMode` の `?? false` とは既定が違う点に注意。
- `settingsStore` の `partialize` から外す（localStorage に書かない）。
  持ち越しによる drift を原理的に消す。
- UI（SessionCreate / SettingsPage）は `writer.setUseStayDurationPriority` 経由に変更。
  ただし SessionCreate は**セッション作成前**なので writer が使えない。作成前の選択は
  ローカル state（`settingsStore` のメモリ上の値）に置き、`createSession` の
  `initialGameState.settings` に含めて書き込む（`recordScores` 等と同じ扱い）。

`finishMatchAndContinue` / `computeFinishAndContinue` の `useStayDurationPriority` も、
`continuousMatchMode` と同様に**リモート settings を優先採用**する。クライアントから
渡された `options.useStayDurationPriority` は旧セッション互換のフォールバックとして
のみ使う。

## 実装対象

### `src/lib/gameOperations.ts`
- `computeFinishAndContinue` の options に `practiceStartTime?: number` を追加し、
  `assignCourts` へ渡す。

### `src/services/sessionService.ts`
- `SyncSettings` に `useStayDurationPriority?: boolean` を追加。

### `src/services/sessionMutations.ts`
- `setUseStayDurationPriority(sessionId, value)` を追加（`computeSetSetting` 利用）。
- `finishMatchAndContinue`: snapshot の `config.practiceStartTime` を読んで渡す。
  `useStayDurationPriority` は `remoteSettings?.useStayDurationPriority ?? options.useStayDurationPriority`
  で解決する。

### `src/hooks/useSessionWriter.ts`
- `setUseStayDurationPriority` を追加。

### `src/hooks/useFirebaseSync.ts`
- `settings.useStayDurationPriority` を `settingsStore` へ反映（未設定は `true` 扱い）。

### `src/stores/settingsStore.ts`
- `partialize` から `useStayDurationPriority` を外す。
- `version` を 3 に上げ、migrate で旧 persist 値を剥がす。

### `src/pages/SettingsPage.tsx`
- トグルを `writer.setUseStayDurationPriority` 経由に変更。

### `src/pages/SessionCreate.tsx`
- `initialGameState.settings` に `useStayDurationPriority` を含める。

### `scripts/auto-create-session.ts`
- 自動作成セッションの `settings` にも `useStayDurationPriority: true` を明示。

## テスト

### `src/lib/gameOperations.test.ts`
- `practiceStartTime` を渡すと、待機時間モードと試合回数モードで連続配置の選出が
  変わる（回帰テスト。渡さない実装では両者が一致してしまうことを担保する）。

### `src/services/sessionMutations.test.ts`
- `computeSetSetting` 経由で `useStayDurationPriority` が settings に入る。

### `src/stores/settingsStore.test.ts`
- `useStayDurationPriority` が localStorage に persist されない。

## 非対象

- 優先スコアの式（`gamesPlayed / 滞在分`）そのものの変更はしない。
- 会費・名簿未完了メンバーを滞在ゼロ扱いにする仕様
  （`2026-08-11-stay-start-at-ops-complete.md`）は変更しない。会費・名簿を運用して
  いないセッションでは全員未完了となり試合回数モードと同順になるが、これは既定の
  仕様どおり。
