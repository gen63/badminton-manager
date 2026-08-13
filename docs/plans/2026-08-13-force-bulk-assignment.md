# 一括配置強制モード（多様性優先の実効化）

## 背景

設定「配置タイミング＝多様性優先」(`prioritizeDiversity`) が実質機能していない。

`MainPage.tsx` の `shouldBlockAssignment` は **バナー2箇所の表示条件にしか使われていない**
（`:1075` 上部バナー / `:1227` 空きコート内「⚠️ 一括配置推奨」）。コート内「配置」ボタン
(`:1232`) も「一括」ボタン (`:949`) も `disabled={!canAutoAssign}` のみで、多様性ブロックは
ボタンを一切止めていない。掲示が出るだけで手動配置は素通りする。

実効性があるのは連続モード経路 `checkContinuousBlock` (`gameOperations.ts:75-92`) だけで、
待機 < 7人（複）のときその回の自動配置を1回見送る。しかも
`2026-06-07-continuous-mode-keep-on-during-diversity-block.md` で「連続モード自体は OFF に
しない」に変えたため、見送られた後に誰かが手動で「配置」を押せば低多様性の4人が入る。

かつては 2026-03-07 の2 plan でハードブロックだったが、現在の形は少なくとも
`2026-05-19-diversity-announcement-fix.md` の時点で既にバナー前提になっている。

## 効能の根拠：プールの同時性

多様性を生んでいるのは「一括ボタンを押すこと」ではなく **配置時の候補プールの大きさ** である。
`handleAutoAssign()`（引数なし＝一括）は *その時点で空いている全コート* を配置するだけなので
(`MainPage.tsx:566-570`)、空き1面の状況では一括＝per-court 配置と動作が同じ。ボタンを一括に
一本化しても、1面空きの瞬間に押せる限り効果はゼロ。

3コート13人での比較:

| タイミング | 空き | プール | 配置 | 中身 |
|---|---|---|---|---|
| 1面終了 | 1 | 待機1＋終了4 = **5人** | 4人 | 元の4人組のうち3人がそのまま復帰。ペアも対戦相手もほぼ据え置き |
| 2面終了 | 2 | 待機1＋終了8 = **9人** | 8人 | **8人が2面に再分配される** → C1の人がC2へ、という組み替えが起きる |

メンバー入れ替わり（連投率）だけ見ると 3/4 → 7/8 で悪化しているが、**組み合わせ（ペア・対戦
相手）の多様性**では2面同時が圧倒的に良い。1面ずつ配置すると2つの4人組が固定化され、待機者
だけがぐるぐる回る最悪パターンになる。

### 解除条件は「空き2面」であって「プレイ中0面」ではない

一括配置に意味があるのは空き2面以上のときだけ。よって **止めるべきは空き1面のときだけ**で、
2面空いた時点で即解除する。3コートで全面終了を待つ必要はなく、アイドルは「2番目に終わる
コートまで」で頭打ちになる。

## 決定事項

### 1. 効果範囲：待機が薄いときだけ

`thin = 待機人数 − 空きコート数 × playersPerCourt ≤ 2` のときだけブロックが働く。

待機が厚いとき（例: 12人2コートで1面終了＝待機8人）は、プール8人から4人選べば時点で連投
ゼロ・ペアも十分入れ替わる。2面まとめる限界効用はほぼ無いのにアイドルは確実に発生するため、
**厚いときは今まで通り1面ずつ即配置**する。

副次的に「基本ずっと ON で置きっぱなしにできる」性質が得られる。状況に応じた切り替えが不要。

### 2. 3状態モデル

現行は「薄い＝バナー1種類」で、待たせている場面と一括すべき場面が同じ表示だった。分離する。

| 状態 | 条件 | 上部バナー | 空きコート | 一括ボタン |
|---|---|---|---|---|
| `waiting`（待機中） | thin かつ 空き1面 かつ 他コートに人がいる | ⏳ 多様性確保のため、あと1面の終了を待っています | 「他コート終了待ち」・配置ボタン無効 | **無効** |
| `bulkOnly`（一括のみ） | thin かつ 空き2面以上 | 💡 2面まとめて配置します | 配置ボタン**非表示** | 有効 |
| `free`（通常） | 上記以外 | **なし** | 従来通り | 有効 |

- `waiting` で一括ボタンも無効にするのが要点。空き1面での一括は per-court と同じ動作なので、
  開けておくと抜け道になる。
- `free` ではバナーを一切出さない。現行は12人2コートのような十分厚い場面でも
  「一括配置を推奨」が出ていたが、そこは1面ずつで問題ないので黙る。

検証:

- 3コート13人: 1面空き→`waiting` / 2面空き→`bulkOnly`（プール9人→8人配置）
- 2コート10人: 1面空き→`waiting` / 2面空き→`bulkOnly`
- 2コート12人: 1面空きも2面空きも `free`（バナーなし、1面ずつ自由）
- 3コート15人: 1面空きで待機7人 → `free`（`2026-03-07-prioritize-rotation-fix.md` の表と一致）

停止性: ブロックが立つのは空き1面のときだけなので、次にどこか1面終われば必ず `bulkOnly` に
遷移して解除される。**現行の判定式をそのまま disabled に流用してはならない**
（10人2コートで両面終了時も `10 − 2×4 = 2 ≤ 2` となり永久に配置不能になる）。

### 3. 命名

- UI ラベル: **「一括配置強制」** ON / OFF
- 内部識別子: `prioritizeDiversity` → **`forceBulkAssignment`**

「多様性優先」は目的の名前で、画面で体験する挙動（1面ずつ押せない・2面空くまで待つ）と
結びついていなかった。「いつ強制されるのか」は説明文が担う。

```
一括配置強制
[    ✓ ON    ] [    OFF    ]
ON : 余りが少ない時は2面空くまで待ってまとめて配置
OFF: 空きが出たら1面ずつ即座に配置
```

単＝OFF固定 / 楽＝ON固定 の出し分け説明文は現行の構造を踏襲する（文言のみ差し替え）。

### 4. デフォルトは ON

練習種別「複」のデフォルトを `false` → `true` に変更。「薄いときだけ効く」ので常時 ON が妥当。
2コート9人などで多様性を犠牲にしてでも試合数を稼ぎたい日は、手動で OFF にする運用。

### 5. Firestore 同期へ移行

`prioritizeDiversity` は `SyncSettings` (`sessionService.ts:37-52`) に入っておらず端末ローカル
persist のみ。ハードブロック化すると **A さんの端末ではボタンがグレーで B さんの端末では
押せる**状態が起きる。さらに `computeFinishAndContinue` にはボタンを押した人の端末の値が渡る
ため「試合終了を押した人の設定で連続配置の挙動が変わる」。

`useStayDurationPriority` を Firestore に移した
`2026-08-11-stay-duration-mode-not-applied.md` と同じ問題なので、同じ対処を取る。

## 実装

### Phase 1: 判定ロジック

#### `src/lib/utils.ts`

`shouldBlockForDiversity` を廃止し、3状態を返す `getAssignmentGate` に置き換える。

```ts
export type AssignmentGate = 'free' | 'waiting' | 'bulkOnly';

export function getAssignmentGate(
  forceBulkAssignment: boolean,
  occupiedCourts: number,
  emptyCourts: number,
  waitingCount: number,
  playersPerCourt: number = 4,
  baseThreshold: number = 2,
): AssignmentGate {
  if (!forceBulkAssignment) return 'free';
  if (emptyCourts === 0) return 'free';            // 配置対象がない
  const thin = waitingCount - emptyCourts * playersPerCourt <= baseThreshold;
  if (!thin) return 'free';
  if (emptyCourts === 1) return occupiedCourts > 0 ? 'waiting' : 'free';
  return 'bulkOnly';
}
```

- `emptyCourts === 1 && occupiedCourts === 0` は1コートセッション。待つ相手がいないので `free`。
- 現行の「3コート以上で全面空きなら推奨しない」エッジケース (`utils.ts:170`) は**削除する**。
  3面全空きこそ一括すべき場面なので、今回のモデルでは不要。
- 未使用だった `_totalActiveCount` 引数も落とす。

#### `src/lib/gameOperations.ts`

`checkContinuousBlock` の独自閾値 (`actualWaiting < getMinWaitingCount(gameMode)`) を
`getAssignmentGate` に一本化する。連続モードは「終わったコート1面に入れる」＝空き1面相当なので
`emptyCourts = 1` 固定ではなく、`updatedCourts` から実際の空き数を数えて gate を求め、
**`free` 以外なら見送る**（`bulkOnly` でも1面だけ入れるのは抜け道になるため）。

複・空き1面では `waiting − 4 ≤ 2` ⟺ `waiting ≤ 6` ⟺ 現行の `< 7` と一致するので、
既存の挙動は保たれる。単は `forceBulkAssignment` が常に false なので早期 return と等価。

`getMinWaitingCount` は `waitingPlayers.length < getMinWaitingCount(...)`
(`gameOperations.ts:253`) の人数不足判定でも使われているのでシンボル自体は残す。

#### テスト

- `src/lib/utils.test.ts`: 既存15件を `getAssignmentGate` ベースに書き換え、上記「検証」表の
  ケース（3コート13人の1面/2面、2コート8-12人、3コート15人、1コートセッション、
  `forceBulkAssignment=false`）を網羅する。
- `src/lib/gameOperations.test.ts`: `diversity_block` 系テストを新条件で更新。

### Phase 2: 設定の同期化・リネーム

`useStayDurationPriority` の実装を**そのままなぞる**（同期の型・writer・mutation・sync の
4箇所）。

- `src/services/sessionService.ts`: `SyncSettings` に `forceBulkAssignment?: boolean` を追加。
  JSDoc に「未設定は `true` 扱い」「セッション全体の挙動を決めるので端末ローカルではなく
  Firestore に持つ」を明記。
- `src/services/sessionMutations.ts`: `setForceBulkAssignment` を追加（`runTransaction`）。
  既存の `prioritizeDiversity` オプション (`:1437` / `:1507`) を改名。
- `src/hooks/useSessionWriter.ts`: `setForceBulkAssignment` を追加。`setPracticeType`
  (`:233-241`) の副作用を「ローカル `setState`」から Firestore 書き込みへ変更し、
  practiceType と同一 transaction で書く（単→false / 楽→true）。
- `src/hooks/useFirebaseSync.ts`: 受信して `settingsStore` へ反映。`?? true` で未設定を
  ON 扱い。`setPracticeType` の副作用に関するコメント (`:241`) を更新。
- `src/stores/settingsStore.ts`:
  - `prioritizeDiversity` → `forceBulkAssignment`、初期値 `false` → `true`
  - `partialize` から除外（Firestore がソース）
  - persist `version: 3` → `4`、`version < 4` で `prioritizeDiversity` を剥がす migration
  - `onRehydrateStorage` の practiceType 整合ロジックを新名に追従
- `src/pages/SettingsPage.tsx` (`:338-384`) / `src/pages/SessionCreate.tsx` (`:420-460`):
  ラベル「配置タイミング / 多様性優先・回数優先」→「一括配置強制 / ON・OFF」、説明文を
  上記の文面に差し替え。SettingsPage 側は writer 経由の Firestore 書き込みに変更
  （SessionCreate はセッション作成前なのでローカル state のままでよいか確認する）。

### Phase 3: MainPage の3状態 UI

- `shouldBlockAssignment` (`:743-751`) → `assignmentGate`。
  `callableReservedCount` (`:755-758`) を `waitingCount` に加算して渡す。現状は
  `canAutoAssign` だけが予約人数を加算していて不整合なので揃える。
  そのため `callableReservedCount` の算出を gate 計算より前へ移動する。
- 上部バナー (`:1075-1081`): gate で文言を出し分け、`free` では非表示。
  `courts.length > 1` ガードは gate 側の `occupiedCourts > 0` / `emptyCourts >= 2` で
  吸収されるので削除してよい。
- 空きコート (`:1225-1241`):
  - `waiting`: 「他コート終了待ち」表示 + 配置ボタン `disabled`
  - `bulkOnly`: 配置ボタン非表示 + 「一括ボタンで配置」案内
  - `free`: 従来通り
- 一括ボタン (`:947-955`): `disabled={!canAutoAssign || assignmentGate === 'waiting'}`
- `handleAddCourt` (`:539`) の `prioritizeDiversity ? getMinWaitingCount(gameMode) : 2`
  も新名・新ロジックに追従。

## 影響範囲・リスク

- **挙動が強くなる変更**。デフォルト ON かつ実際にボタンが押せなくなるので、薄い人数帯
  （8〜10人2コート、12〜14人3コート）では待ち時間が発生する。目白実測（試合5〜9分・σ≒1分、
  `2026-08-13-next-match-call-notification.md`）ならコート間のズレは1〜2分程度で許容範囲。
  合わない日は設定を OFF にして回避できる。
- 連続モード ON 時、薄いセッションでは自動配置が事実上ほぼ発火せず手動一括が主導線になる。
  ただし現行 `checkContinuousBlock` も同条件で既に見送っているため実質的な後退はない。
- Firestore 同期化により、設定変更が全端末へ即時反映されるようになる（意図した変更）。
- persist migration により既存端末の `prioritizeDiversity` は破棄され、Firestore 値
  （未設定なら ON）が採用される。

## 別チケット

3コートセッションで2面同時配置するとき、`assign2CourtsHolistic` は
`totalCourtCount === 2 && normalCourtCount === 2` 条件 (`algorithm.ts:2299`) を満たさず
3コート用の逐次経路に落ちる。今回の変更で2面一括が主要導線になるため効果を測りたい。
→ https://github.com/gen63/badminton-manager/issues/308

## 検証

```bash
npm run build && npm run lint && npm run test:run
```
