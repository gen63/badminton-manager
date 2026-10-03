# 会費・名簿の完了で強制休憩から自動復帰

2026-10-03

## 背景 / 要望

- 会費・名簿が未対応のメンバーは `computeEnforceForcedRest` で強制休憩になる
  （`docs/plans/2026-07-09-unpaid-auto-rest.md` / `2026-07-20-unpaid-forced-rest-every-match.md`）。
- 対応後も本人が手動で休憩を解除する必要があった。**両方完了したら自動で休憩から復帰**させたい。

## 設計

- `Player.forcedRestActive?: boolean` を追加。現在の休憩が会費・名簿の強制休憩によるときだけ true。
- `computeEnforceForcedRest`（初回・再発火とも）で `isResting: true` + `forcedRestActive: true`。
  結果未登録休憩（`computeEnforceUnrecordedRest`）はセットしない（自動復帰の対象外）。
- 手動の休憩切替（`computeToggleRest`）・全員休憩（`computeSetAllPlayersResting`）は
  `forcedRestActive` を false に降ろす（自主休憩は自動解除しない）。`forcedRestAt` は残す
  （再発火判定が依存するため）。
- `computeToggleOperationStatus` / `computeApplyPayment` の更新後、会費・名簿が両方 true かつ
  `isResting && forcedRestActive` なら `isResting: false` + `forcedRestActive: false`。
  `activatedAt` は 0 のときのみ now（`computeToggleRest` と同じ）。
- Firestore は undefined 不可のため、解除は key 削除でなく `false` で表す。
- 本人通知文言を「対応すると自動で休憩が解除されます」に変更。

## 到着時の自動復帰（追記）

- 練習開始時は全員 `isResting: true, activatedAt: 0` で追加され、到着時に手動で休憩解除していた。
- `withAutoResume` の対象を「`forcedRestActive` **または** `activatedAt === 0`（未到着）」に拡張。
  会費・名簿が両方完了した時点で待機になり、`activatedAt = now`（チェックイン時刻）。
- 一度到着後に自主休憩した人（activatedAt > 0、フラグなし）は対象外。
- `forcedRestActive` は立っていたときだけ false に降ろす。

## 再休憩との関係

- 自動復帰後に再び未対応へ戻した場合は何もしない。次の試合後に既存の再発火ロジックが
  `forcedRestAt` 基準で再度強制休憩にする。
