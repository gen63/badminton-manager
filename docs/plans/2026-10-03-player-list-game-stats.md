# 参加者一覧: 試合数統計と滞在時間表示

## 目的
回数平均 / 滞在時間モードで試合数が適切に割り振られているかを管理者が確認できるようにする。

## 変更
- ソートボタン（試合数が多い順 / 見ていない順）タップで完了済みアコーディオンを展開。
- 管理者かつ sortMode='games' のとき、リスト上に統計パネル（最大 / 最小 / 中央値、最長滞在）。
- 管理者のみ、各カード2行目に `滞在 H:MM (最長比%)`。会費・名簿未完了は `滞在 —（未完了）`。
- 計算は純粋関数 `src/lib/playerStats.ts`（テスト `playerStats.test.ts`）。
- 滞在起点は `algorithm.ts` の `resolveStayStart` を export して再利用（アルゴリズムと一致）。
  表示用なので MIN_STAY_MINUTES の下限は適用しない。分母は全員中の最大滞在分（0 なら割合なし）。

## 非対象
アルゴリズムの挙動変更なし。Firestore スキーマ変更なし。

## 追記: 期待試合数と並び順の変更（2026-10-03）
- ソートボタン（試合数が多い順 / 見ていない順）と `sortMode` を廃止。最終参照（lastSeen）表示もカードから撤去。
- 期待試合数 `computeExpectedGames`（`playerStats.ts`）:
  - 回数平均モード（`useStayDurationPriority=false`）: 全員の試合数合計 / 人数。
  - 滞在時間モード: 会費・名簿完了者だけで、完了者の試合数合計を滞在分で按分。未完了者・滞在合計0は null。
  - 差 = 実績 − 期待値。
- 並び順（全員共通、非管理者も同じ）: 差が小さい順（足りていない人が上）。差 null は後ろ（試合数昇順）、最終 tie-break は名前昇順。
  `playerSort.ts` の `sortPlayersByExpectedDiff(players, expectedById, currentUser)` が `{ self, others }` を返す。
- 本人（`currentUser` と name 一致）は未完了/完了済み・アコーディオンの開閉に関係なく最上部に固定し、下のグループ・完了済み人数からは除外。
- 表示: カード2行目 `N試合 期待 x.x (±d.d)`（差 −1.0 以下は amber）+ 滞在時間モードのみ滞在。統計パネル（最大/最小/中央値、滞在時間モードは最長滞在）。いずれも管理者のみ。非管理者は `N試合` のみ。
- 並びが滞在按分に依存するため、30秒ごとの `now` tick は全員で動かす。


- 滞在時間（表示・割合・期待値の按分・並び順）は練習終了時刻（`resolvePracticeEndTime`。未設定は開始+3時間）で頭打ち。`computeStayStats` の省略可能な `practiceEndTime` 引数で `effectiveNow = min(now, end)` を使う。表示側のみで、アルゴリズムの優先度計算は変更しない。
