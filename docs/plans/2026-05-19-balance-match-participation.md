# 練習後半の試合回数均等化モード

- 起票日: 2026-05-19
- ブランチ: `claude/balance-match-participation-oZ9F1`

## 背景・課題

通常の体育館練習は 2.5〜3 時間で、最初 30 分がウォーミングアップ、最後 15 分が
片付けに割かれることが多い。現在の配置ロジックは以下の通り:

- `useStayDurationPriority=true` (待機時間優先・デフォルト): 優先度 = `gamesPlayed / 滞在分`
- `useStayDurationPriority=false` (試合回数優先): 優先度 = `gamesPlayed * 0.4`
- `selectBestFour` (algorithm.ts:765-822) は上記優先度合計に「性別 3-1 構成
  ペナルティ」と「同一 4 人組リピートペナルティ」を加算し、最小スコア組を選ぶ。

→ 回数優先モードでも、性別/組合せ多様性の制約により**試合回数の偏差**は累積する。
この偏差は意図的に許容されているが、練習後半まで偏ったままだと「最後まで多く
入った人と少なく終わる人」の差が固定化してしまう。

ユーザーの要望:
> 練習後半になったときには試合回数の偏りを均等にするようなロジックとしたい。
> 一定時間が経過したとき、試合回数が少ないメンバーを優先的に試合に入れる動きにしたい。

## 仕様

### 新概念: 「後半均等化モード」(`lateBalanceMode`)

オンになると、`calculatePriorityScore` に**差分ペナルティ**を加算する:

```
penalty = (maxGamesPlayed - player.gamesPlayed) * LATE_BALANCE_WEIGHT * oneGameDelta
finalScore = baseScore - penalty
```

- `maxGamesPlayed`: アクティブプレイヤー中の最大試合数
- `LATE_BALANCE_WEIGHT`: 定数 (案: 2.0)。`oneGameDelta` は既存の 1 試合分スコア差
- `selectBestFour` が `playerScore` 経由で `calculatePriorityScore` を呼ぶので、
  グループ単位の選択にも自然に伝播する。
- 性別 3-1 ペナルティ (`oneGameDelta * 3.0`) より弱めに設定することで、後半でも
  「3-1 だけは絶対に避ける」性質は維持される。ただし MIX vs 同性 (差: 0.5) 程度
  なら回数差を優先できる。
- combo-repeat ペナルティ (3 回目以降 `oneGameDelta * 3`) も同様に MIX 制約より
  弱いまま機能する。

### 自動オン条件

- `useStayDurationPriority === false` (回数優先モード) かつ
- `lateBalanceAutoFired === false` (まだ自動オンが走っていない)

→ 残り時間に応じて分岐:
  - `practiceStartTime + 90min > now`: `setTimeout` で残り時間後に発火
  - `practiceStartTime + 90min <= now`: マウント直後に即発火
- 発火時は `markLateBalanceAutoFired` mutation を呼び、
  `lateBalanceMode=true` & `lateBalanceAutoFired=true` を 1 transaction で書く。

### 1 セッションにつき 1 度きり (Firestore で保証)

`lateBalanceAutoFired` フラグを Firestore に持つことで、画面遷移 / 再マウント /
ページ再読み込み / **PWA の完全終了からの再起動** を跨いでも 1 度きりの発火を保証する。

挙動:
- 自動オン後にユーザーが手動 OFF → `autoFired=true` のため再発火しない (OFF 維持)
- 90 分経過後に初めて MainPage を開いた / PWA を再起動 → 未発火なら即発火 (新規参加・再起動の救済)
- 既に発火済み(=管理者が後に OFF にした)状態で別デバイスから接続 → 何もしない

`markLateBalanceAutoFired` は transaction 内で idempotent (`autoFired` が既に
true なら no-op)。複数クライアント同時発火でも 1 度しか書き込まれない。

手動 `setLateBalanceMode(true)` は `lateBalanceAutoFired` を変えない (自動オン
イベントと手動 ON/OFF は独立)。

### 手動操作

`SettingsPage` にトグル UI を追加し、admin が任意のタイミングで ON/OFF できる。
オンになっていれば 90 分経過前でも均等化が効く。

### 既存設定との関係

- 「待機時間優先」(`useStayDurationPriority=true`) モードでは、自動オンは
  発火しない。ただし手動で ON にすれば均等化ペナルティは加算される。
- ユーザー回答の通り「回数優先のとき自動でオン」が基本動線。
- 練習タイプ (単/複/楽) は問わない。

## 影響範囲

### 型 / Firestore スキーマ

`src/services/sessionService.ts:35` の `SyncSettings` に 2 フィールド追加:

```ts
interface SyncSettings {
  recordScores?: boolean;
  continuousMatchMode?: boolean;
  practiceType?: '単' | '複' | '楽';
  lateBalanceMode?: boolean;        // 現在の ON/OFF 状態
  lateBalanceAutoFired?: boolean;   // 90 分自動オンが走ったか (1 セッション 1 度きりの保証用)
}
```

### Algorithm

`src/lib/algorithm.ts`:
- `calculatePriorityScore(player, practiceStartTime, useStayDuration, lateBalanceCtx?)`
  - `lateBalanceCtx = { enabled: boolean; maxGamesPlayed: number; oneGameDelta: number }`
  - enabled なら `gamesPlayed === 0` の最優先扱いの後で `(maxGames - p.gamesPlayed) * 2 * oneGameDelta` を減算
- `assignCourts` の `options` に `lateBalanceMode?: boolean` 追加
- `selectBestFour` / `calculateGroupPriorities` に lateBalanceCtx を伝搬

### 状態同期 (Settings store + Firebase Sync)

- `src/stores/settingsStore.ts` に `lateBalanceMode` / `lateBalanceAutoFired` を
  追加 (UI 操作と Firestore 反映用)。Firestore 同期対象なので persist 対象外。
- `src/services/sessionMutations.ts`:
  - `setLateBalanceMode(sessionId, value)`: 手動トグル用。`lateBalanceAutoFired`
    は触らない。
  - `markLateBalanceAutoFired(sessionId)`: 自動オン用。idempotent。`autoFired` が
    既に true なら no-op、未発火なら `mode=true` & `autoFired=true` を 1
    transaction で書く。
- `src/hooks/useFirebaseSync.ts` で両フィールドをローカル store に反映。
- `src/hooks/useSessionWriter.ts` から両 mutation を公開。

### 自動オン発火

`src/pages/MainPage.tsx`:
- `useEffect` の判定軸を `lateBalanceAutoFired` に変更。
- 90 分到達前は `setTimeout` で残り時間後に発火。到達済み&未発火ならマウント
  直後に即発火 (PWA 再起動・遅参加の救済)。
- 発火は `writer.markLateBalanceAutoFired()` 経由。transaction 内で idempotent。
- cleanup で `clearTimeout`。
- 依存配列に `lateBalanceAutoFired` を含めるので、autoFired が true になった
  瞬間に effect が再評価され早期 return → timeout クリア。
- 複数タブ / 複数クライアントで開いていても、最初の write で `autoFired=true` に
  なり、他クライアントの onSnapshot 同期 → useEffect 再評価で発火が抑止される。

### UI

`src/pages/SettingsPage.tsx`:
- 配置タイミング設定の直下に「後半均等化」セクションを追加。
- トグル ON/OFF (ローカル即時反映 + Firestore 書き込み)。
- 説明文: 「90分経過後に自動で ON。試合数の少ない人を強く優先します」。

`src/pages/MainPage.tsx`:
- 軽いインジケーター: lateBalanceMode が ON の間、画面上部に「均等化モード」
  のバッジを 1 行表示 (既存の周知事項エリア下あたり)。常時意識させすぎない
  ように小さく。

### テスト

`src/lib/algorithm.test.ts` に追加:
- `lateBalanceMode=true` で、gamesPlayed が極端に少ないプレイヤーが選ばれる
  ことを確認する。
- `lateBalanceMode=false` (現状) と挙動が変わらないことを確認する。
- 性別 3-1 ペナルティが lateBalance ペナルティに負けないことを確認 (定数調整)。

`src/services/sessionMutations.test.ts` (もしあれば) に:
- `setLateBalanceMode` / `markLateBalanceAutoFired` の idempotency。

## 非対応 (今回スコープ外)

- 練習終了時刻 (`practiceEndTime`) の追加。今回は「開始からの経過時間」のみで
  判定するためスキーマ変更を最小化する。将来「残り時間」ベースで判定したく
  なったら別 plan で `practiceEndTime` または `practiceDurationMinutes` を
  足す。
- lateBalance ON 中のリアルタイム可視化 (個人ごとの残り推定試合数など)。

## 動作確認手順

1. `npm run build && npm run lint && npm run test:run` が全て通ること。
2. 開発サーバーで以下シナリオを確認:
   - 回数優先モード + 90 分到達でトグルが自動でオンになる (アプリ open 中)。
   - **自動オン後に手動 OFF にして画面遷移しても OFF が維持される** (`autoFired=true`
     のため再発火しない)。
   - ページ再読み込みでも OFF が維持される。
   - PWA を完全終了 → 90 分経過後に再起動: 未発火なら即自動オン。発火済みなら
     現在の mode (OFF にしていたなら OFF) が維持される。
   - lateBalanceMode ON 中、試合数が少ないプレイヤーが次の配置で入りやすくなる。
   - 性別 3-1 構成は (回数差が小さければ) 引き続き避けられる。
3. 複数タブ / 複数クライアントで同時に開いて競合しないこと (transaction が
   idempotent)。

## ファイル変更まとめ

- `src/services/sessionService.ts` - SyncSettings 拡張
- `src/services/sessionMutations.ts` - setLateBalanceMode / markLateBalanceAutoFired
- `src/hooks/useFirebaseSync.ts` - lateBalanceMode 同期
- `src/hooks/useSessionWriter.ts` - mutation 公開
- `src/stores/settingsStore.ts` - lateBalanceMode フィールド
- `src/lib/algorithm.ts` - calculatePriorityScore / selectBestFour / assignCourts
- `src/pages/MainPage.tsx` - 自動オン発火 + バッジ表示 + assignCourts への伝搬
- `src/pages/SettingsPage.tsx` - 手動トグル UI
- `src/lib/algorithm.test.ts` - 新規テスト
