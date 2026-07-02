# 予約中メンバーを考慮した配置可能人数の判定（2コート10人+4人予約対応）

2026-07-02

## 背景 / 問題

2コート・10人のセッションで4人予約を入れると、試合の配置ができなくなる。

予約メンバーは予約作成時に休憩（isResting=true）になる運用
（`docs/plans/2026-05-25-reservation-block-by-games-played.md`）のため、
4人予約を入れると待機プールは最大6人になる。これにより以下の3箇所の
「人数不足」判定に引っかかり、予約が成立可能な状態でも配置が止まる:

1. **連続モードの最小待機人数ゲート**（`computeFinishAndContinue`）:
   `waitingPlayers.length < getMinWaitingCount('doubles')=7` を無条件に判定。
   4人が予約休憩に回ると待機は最大6人となり、連続自動配置が二度と発火しない。
   2026-05-25 plan の「既知の制限（今回スコープ外）」として先送りされていたもの。
2. **配置ボタンの活性判定**（MainPage `canAutoAssign`）:
   `sortedWaitingPlayers.length >= playersPerCourt` のみで判定。
   予約成立で休憩から呼び出せるメンバー（4人予約なら4人）を無視するため、
   待機2人+予約成立可能4人の状態でもボタンが無効になり、手動でも配置できない。
3. **`assignCourts` の insufficient-players エラー**:
   一括配置（2コート分）で予約が保留（試合数中央値+閾値）または未成立のとき、
   通常候補6人 < 必要8人で例外を投げ、**1コートも配置されない**（部分配置なし）。

## 方針

「予約が成立可能な pending 予約の休憩メンバー」は実質配置に使える人員なので、
配置可能人数のカウントに含める。また `assignCourts` は全コートを埋められない
場合でも埋められる分だけ部分配置する。

### 1. `getCallableReservationRestingIds`（algorithm.ts に新設・export）

pending 予約のうち以下を全て満たすものの**休憩中メンバー ID 集合**を返す:

- 予約人数が 1〜playersPerCourt 人（singles=2, doubles=4）
- メンバー全員が在席し、誰もコートで試合中でない（成立可能）
- 試合数が中央値+閾値（`reservationBlockThreshold`）以上のメンバーを含まない
  （= `assignCourts` の予約保留判定で保留されない）
- 待機人数で残り枠を補充できる（`waiting >= playersPerCourt - 予約人数`）

中央値の母集団は在席全員（休憩者含む）で `assignCourts` と揃える。
複数予約にまたがるメンバーは Set で重複排除。

※ 複数予約が待機者を取り合うケース等の厳密な成立判定はしない（近似）。
最終判定は従来どおり `assignCourts` 本体が行い、不一致時はエラートーストで通知。

### 2. 連続モードゲートの緩和（gameOperations.ts）

- `computeFinishAndContinue`: 上記 callable 数を待機人数に加算して
  `getMinWaitingCount` ゲートと `checkContinuousBlock`（多様性ブロック）を判定。
- `checkContinuousBlock` に `callableReservedCount`（default 0）引数を追加。
- `assignCourts` 呼び出しを try/catch で包み、例外時は
  `continuousError='assignment_failed'`（ゲート緩和により理論上
  insufficient が到達しうるため transaction を壊さない）。

### 3. 配置ボタン活性判定（MainPage.tsx）

`canAutoAssign = emptyCourts > 0 && (待機人数 + callable数) >= playersPerCourt`。

### 4. `assignCourts` の部分配置（algorithm.ts）

通常配置の候補が「残りコート数×必要人数」に満たない場合、例外ではなく
`floor(候補数 / 必要人数)` コート分だけ配置する（doubles / singles 両方）。
1コートも埋められない場合のみ従来どおり（予約配置があればそれのみ返す、
無ければ insufficient-players を投げる）。
MainPage の一括配置では、要求コート数より配置結果が少ない場合に
info トーストで部分配置を通知。

## 動作イメージ（2コート10人・4人予約 R1-R4）

- 両コート空きで一括配置: C1=予約4人、C2=待機6人から4人（従来どおり成立）
- 予約が保留（試合数超過）でも、C1 に待機6人から4人を部分配置（従来: エラーで0面）
- C2 試合中・C1 空き・待機2人・予約成立可能: 配置ボタンが活性化し C1=予約4人
- 連続モード: 試合終了後の待機6人+呼出可能4人=10 >= 7 でゲート通過、
  終了コートに予約4人を自動配置（従来: not_enough_players で発火せず）

## 変更ファイル

- `src/lib/algorithm.ts`: `getCallableReservationRestingIds` 新設 /
  doubles・singles の通常配置を部分配置化
- `src/lib/gameOperations.ts`: `checkContinuousBlock` 引数追加 /
  `computeFinishAndContinue` のゲートに callable 数を加算 + try/catch
- `src/pages/MainPage.tsx`: `canAutoAssign` に callable 数を加算 /
  一括配置の部分配置トースト
- テスト: `algorithm.test.ts` / `gameOperations.test.ts` に追加

## スコープ外

- 連続モードの最小待機人数 7（doubles）自体の見直し
  （10人2コートでは予約なしでも待機6人でゲートを下回る問題は別議論）
- 予約同士が待機者を取り合う場合の厳密な成立可否判定
