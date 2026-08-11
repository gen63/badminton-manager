# 滞在時間モードの起点を「名簿＋会費 両方完了時刻」に変更

- 起票日: 2026-08-11
- ブランチ: `claude/match-count-start-point-mcmj2h`

## 背景・課題

待機時間（滞在時間）優先モード（`useStayDurationPriority=true`）の優先度は

```
優先スコア = gamesPlayed / max(滞在分, 5)   // 低いほど優先
```

で、滞在開始時刻は `algorithm.ts` の `calculatePriorityScore` にて

```ts
const stayStart = Math.max(practiceStartTime, player.activatedAt ?? now);
```

と決めている。`activatedAt` は「休憩→待機に切り替わった最初の時刻」
（`computeToggleRest` / 予約削除時の復帰で `activatedAt === 0` のときだけセット）
であり、実質「初回チェックイン時刻」。

しかし運用上、体育館に来て待機に入れられただけで会費も名簿も未対応のまま
滞在時間だけが積み上がる。会費・名簿を済ませた人より、済ませていない人の
優先度が上がるのは不公平。

ユーザーの要望:
> 滞在時間モードの時、休憩からの復活がカウント開始だが、名簿と支払いの両方完了を
> 起点とするよう変えたい。

未完了メンバーの扱いは **「滞在時間ゼロ扱い」** で確定（ユーザー確認済み）。

## 仕様

### 1. 新フィールド `Player.opsCompletedAt`

```ts
opsCompletedAt?: number; // 会費・名簿が両方完了になった時刻（Unix timestamp、未完了は undefined）
```

- **セット条件**: 操作の結果 `operationStatus.payment === true &&
  operationStatus.roster === true` になり、かつ `opsCompletedAt` が未設定のとき、
  その時刻をセットする。
- **一度セットしたらクリアしない**（set-once）。誤操作でどちらかを OFF→ON し直しても
  滞在時間がリセットされて不利にならないようにするため。

### 2. 滞在開始時刻の決定ルール

`calculatePriorityScore`（`useStayDuration=true` の分岐）を次に変更する:

| プレイヤーの状態 | 滞在開始時刻 |
| --- | --- |
| 会費・名簿とも完了 & `opsCompletedAt` あり | `max(practiceStartTime, opsCompletedAt)` |
| 会費・名簿とも完了 & `opsCompletedAt` なし（既存セッション互換） | `max(practiceStartTime, activatedAt ?? now)`（従来どおり） |
| どちらか未完了 | `now`（＝滞在時間 0 → 下限 5 分扱い） |

補足:
- `gamesPlayed === 0` は従来どおり `-Infinity`（初回保証）で先に return するため、
  会費・名簿未対応でも「初回 1 試合」は保証される。
- 全員が未完了の場合は全員 `gamesPlayed / 5` となり、順序は試合回数昇順と等価。
  混乱は起きない。
- 未対応者は `FORCED_REST_GRACE_MS`(30 分) で強制休憩になるため、この不利が効くのは
  実質参加直後の 30 分間。

## 実装対象

### `src/types/player.ts`
- `opsCompletedAt?: number` を追加（コメント付き）。

### `src/services/sessionMutations.ts`
`operationStatus` を書き換えるのは以下 2 箇所のみ。両方で set-once ロジックを適用する。
共通ヘルパー（例: `withOpsCompletedAt(prev, nextStatus, now)`）に切り出して重複を避ける。

- `computeToggleOperationStatus`（L251-274）: `field` トグル後の status で判定。
- `computeApplyPayment`（L284-308）: `payment: true` 適用後の status で判定。

※ `computeUpdatePlayer` は汎用更新だが `operationStatus` を渡す呼び出しは無いため対象外。

### `src/lib/algorithm.ts`
- `calculatePriorityScore`（L1092 付近）の `stayStart` 算出を上表のルールに変更。
  判定は小さなヘルパー（例: `resolveStayStart(player, practiceStartTime, now)`）に
  切り出し、コメントで 3 ケースを明記する。
- ファイル冒頭付近の滞在時間まわりのコメント（`MIN_STAY_MINUTES` など）で
  「休憩解除時刻が起点」と書かれている箇所を更新。

## テスト

### `src/services/sessionMutations.test.ts`
- 名簿 ON → 会費 ON の順で `opsCompletedAt` が 2 回目の操作時刻にセットされる。
- 片方だけ ON では `opsCompletedAt` が undefined のまま。
- 両方完了後にどちらかを OFF→ON し直しても `opsCompletedAt` が変わらない（set-once）。
- `computeApplyPayment` 経由でも（名簿済みなら）`opsCompletedAt` がセットされる。
- 金額修正（既に payment=true）で `opsCompletedAt` が上書きされない。

### `src/lib/algorithm.test.ts`
- 滞在時間モードで、同じ `gamesPlayed` なら `opsCompletedAt` が古い人が優先される。
- `activatedAt` が古くても `opsCompletedAt` が新しければ優先されない
  （＝起点が `opsCompletedAt` に変わったことの確認）。
- 会費・名簿どちらか未完了かつ `gamesPlayed > 0` のメンバーは、完了済みで滞在の長い
  同回数メンバーより後回しになる。
- `opsCompletedAt` 未設定 & 両方完了（既存セッション互換）は従来どおり
  `activatedAt` 起点で動く。
- `gamesPlayed === 0` は未完了でも最優先（初回保証）が維持される。

## 非対象

- 試合回数優先モード（`useStayDurationPriority=false`）は変更なし。
- 強制休憩（`FORCED_REST_GRACE_MS`）の仕様変更なし。
- UI 表示（滞在時間の可視化）の追加はしない。
