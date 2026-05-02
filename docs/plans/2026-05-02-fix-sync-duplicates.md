# 同期によるメンバー重複・操作巻き戻り の修正

## Context（背景）

ユーザー報告:
1. **「最初は一意だったメンバーが操作によって重複」** - 同じプレイヤーが複数のコートに同時に表示される（例: スクリーンショットでは「げん」「田山」が Court1 と Court2 の両方に存在）。
2. **「交換操作をすると元に戻ることがある」** - スワップ（プレイヤー交換）操作直後、片方のクライアントで変更が消える。

これは **同時編集時の3-wayマージが2つの不変条件を守れていない** ことが根本原因:
- (a) **「同一プレイヤーIDは同時に1コートにしか存在しない」が破られる**（→ 重複）
- (b) **同一コート内の異なるポジションへの並行変更が共存できない**（→ 巻き戻り）

意図する成果: 2人以上が同時に操作しても、メンバー重複は発生せず、別ポジションへの編集は両方保持されるようにする。

---

## 根本原因（コード確証済み）

### 原因1: 重複 — `mergeById` がコート横断の不変条件を持たない

`src/lib/syncUtils.ts:123-175` の `mergeById` は **コート単位** の比較で local/remote を選ぶ。コートをまたぐプレイヤーIDの重複チェックは存在しない。

**重複再現シナリオ**（A, B が並行操作、X は最初は待機中）:
1. A: `handleSwapPlayer(court1, 0, X)` → A のローカルでは Court1 に X
2. B: `handleSwapPlayer(court2, 0, X)` → B のローカルでは Court2 に X
3. A が先に push。Firestore: Court1=[X], Court2=空
4. B の onSnapshot 受信 → 3-way merge:
   - Court1: base 空, local 空（B は Court1 を触っていない）, remote=[X] → `localChanged=false` → remote 採用 → Court1=[X]
   - Court2: base 空, local=[X], remote 空 → `localChanged=true` → local 採用 → Court2=[X]
   - **結果: X が両コートに存在**（B 側で重複が発生し、その後 push されて A 側にも伝播）

### 原因2: 巻き戻り — `mergeById` がコート全体を JSON.stringify で比較

`syncUtils.ts:153` の比較 `JSON.stringify(baseItem) !== JSON.stringify(localItem)` は、コートオブジェクト全体（`teamA[0..1]`, `teamB[0..1]`, `restingPlayerIds`, `isPlaying`, `startedAt`, `scoreA`, `scoreB` 等）をひとまとめに扱う。同一コート内で別ポジションを並行編集すると、片方の変更が必ず捨てられる。

**巻き戻り再現シナリオ**（同じ Court1 を A, B が異なる位置で編集）:
- Base: Court1 = `[X, Y, P, Q]`
- A: pos1 を Y→R に交換 → A local: `[X, R, P, Q]`
- B: pos2 を P→S に交換 → B local: `[X, Y, S, Q]`
- A が先 push。B が onSnapshot 受信:
  - base `[X,Y,P,Q]`, local `[X,Y,S,Q]`, remote `[X,R,P,Q]`
  - `localChanged=true` → local 全体採用 → `[X, Y, S, Q]`
  - **A の R が失われる（B 側で巻き戻り表示）**

---

## 修正方針

`src/lib/syncUtils.ts` の courts マージを2層で改善する。

### Step 1: コート内をフィールド/ポジション粒度で 3-way マージする `mergeCourt`

新しいヘルパー `mergeCourt(base, local, remote)` を追加:

- `teamA[0]`, `teamA[1]`, `teamB[0]`, `teamB[1]`: 位置単位で 3-way 比較。`base[i] !== local[i]` なら local を、そうでなければ remote を採用。
- `isPlaying`, `startedAt`, `finishedAt`, `scoreA`, `scoreB`: スカラ 3-way（local が変更されていれば local、そうでなければ remote）。
- `restingPlayerIds`: 配列だが順序は意味を持たないため、Set 化して `(base, local, remote)` の和差で 3-way（base→local で追加されたID は維持、base→local で削除されたID は除外、それ以外は remote 反映）。
- `id`: 不変。

### Step 2: courts 配列レベルのマージ — `mergeById` の代わりに `mergeCourts` を導入

`mergeGameState`（`syncUtils.ts:270-288`）の `courts` だけを `mergeById` → `mergeCourts(base, local, remote)` に差し替える。`mergeCourts`:

1. base/local/remote それぞれを id でマップ化。
2. local の順序を保ったまま走査:
   - 3者にあるコートは `mergeCourt` でフィールド粒度マージ
   - local のみ / base にあって remote から消えた等のケースは `mergeById` と同じ挙動を踏襲（コート追加・削除を尊重）
3. remote のみに存在する新規追加コートを追加。
4. **最後にコート横断重複除去（dedup）** を実施:
   - 全コートの `teamA`/`teamB` を走査し、同じプレイヤーID が2箇所以上にあるかを検出。
   - 重複を検出した場合、以下の優先度で「残すコート」を決定:
     1. **マージ後 `isPlaying: true` のコート（試合中はロック扱い）**
        — 試合進行中のメンバーをdedupで抜くと進行中の試合を破壊するため最優先で保持。
        スクリーンショット再現シナリオ（A が一括配置で Court1 を開始 → B が古い待機リストから
        同じメンバーを Court2 の per-court 配置に使用 → push）で Court2 側を空にする。
     2. base から teamA/teamB が変更されたコート（直近のローカル操作）
     3. 同点なら court.id の小さい方
   - 残さない側のコート上の該当スロットは `''`（空文字）に置換し、ユーザが再配置できる状態に。

> 注: 重複は merge 後に「本来1ヶ所のはずが2ヶ所になった」結果なので、local 優先（自分の操作を見せる）+ 押し負けは次回の onSnapshot で正しく収束する（最終的に最後に push したクライアントが勝つ last-write-wins）。これは現行の整合性モデルと一致する。

### Step 3: `mergeGameState` から呼び出し

`syncUtils.ts:278-282` の courts 部分を:
```ts
courts: mergeCourts(
  base.courts as Court[],
  local.courts as Court[],
  remote.courts as Court[],
),
```

`SyncGameState['courts']` の型は最低限 `id: number` を要求しているが、courts 専用マージ用に内部で `Court` 型として扱う（既存の as キャストパターンに合わせる）。

---

## 修正対象ファイル

- **`src/lib/syncUtils.ts`** （主修正）
  - 新規追加: `mergeCourt`（コート内フィールド粒度 3-way マージ）
  - 新規追加: `mergeCourts`（courts 配列レベル + コート横断 dedup）
  - 修正: `mergeGameState` 内 courts のマージ呼び出しを差し替え
  - 既存 `mergeById` は players / reservations では引き続き使用。

- **`src/lib/syncUtils.test.ts`** （新規ユニットテスト追加、既存に追従）
  - 重複再現テスト（原因1のシナリオ）→ dedup で 1ヶ所に解消されることを確認
  - 巻き戻り再現テスト（原因2のシナリオ）→ A の R と B の S が共存することを確認
  - 既存の courts マージテスト（`courtsマージ:` 系）が依然として通ることを確認

---

## 既存ユーティリティの再利用

- `mergeById` は **players / reservations** ではそのまま使用（これらは横断不変条件を持たないため OK）。
- `mergeMatchHistory`, `mergeSettings` は変更なし。
- `applyRemoteData`（`src/hooks/useFirebaseSync.ts:148-296`）の呼び出しパスは変更なし。`mergeGameState` の戻り値の courts が新ロジックの結果になるだけ。
- スワップ操作側（`MainPage.tsx` の `handleSwapPlayer` / `handlePlayerTap`）は **修正不要**。ローカル単独では重複は発生せず、merge ロジックを直すだけで両方の症状が解消する。

---

## 検証

### ユニットテスト
`npm run test:run` で以下を含むテストが通ること。
- 既存 `syncUtils.test.ts` の全テスト（特に `courtsマージ:` 系の 7 ケース）
- 追加: コート横断重複の解消テスト（local 配置を残し remote 側のスロットを空に）
- 追加: 同一コート内の異なるポジション編集が両方保持されるテスト
- 追加: `restingPlayerIds` の Set 3-way（追加・削除）

### コミット前必須チェック（`CLAUDE.md` 準拠）
```bash
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm run test:run # vitest
```

### 手動検証（推奨）
2 つのブラウザ/タブで同じセッションに参加し、ネットワーク遅延を再現するため両方を開いた状態で:

1. **重複再現テスト**: 同一の待機中メンバー X を、片方の Court1、もう片方の Court2 に同時配置 → 数秒後、両者の画面で X が1コートのみに表示されること。
2. **巻き戻りテスト**: 片方が Court1 の team A を交換、もう片方が Court1 の team B を交換 → 両者の交換が両画面で残ること。
3. **既存リグレッション**: `2026-04-26-fix-match-reset-bug.md` の「試合開始保持」「コート増減」シナリオが引き続き動くこと。
