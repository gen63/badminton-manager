# 予約の編集 / 予約追加画面の「試合中」表示

## 目的
1. 予約追加画面（メンバー選択）で、コートで試合中の人に「試合中」バッジを出して分かるようにする。
2. 予約一覧で未消化（pending）の予約のメンバーを編集できるようにする。

## 方針
- **試合中バッジ**: `PlayerPickList` の名前行に、`usePlayerGameStats().inCourtIds` に含まれる人は
  「試合中」（緑）を表示。試合中なら「休憩中」より優先。ペア希望追加モーダルも同じリストなので同様に出る。
- **編集権限**: `canEditReservation(reservation, currentUser, isCreator)`（`lib/reservationUtils.ts`）。
  pending のみ、予約者本人（`createdBy === currentUser`）か作成者以上（`isCreator()`＝作成者・開発モード）。
  管理者（admins）は作成者未満なので本人の予約のみ。クライアント側チェックのみ（信頼モデルどおり）。
- **UI**: 予約カードに鉛筆ボタン（権限があるときだけ）。`ReservationAddModal` を `initialPlayerIds` 付きで
  開き、見出しを「予約編集」に。期待差ゲートは追加時と同じ（作成者以外は期待差+1.5以上を新たに選べない。
  既に入っている人は選択済みのまま維持でき、外すこともできる）。
- **書き込み**: `computeUpdateReservation(state, id, playerIds, now)` を transaction で。
  番号・追加者・優先フラグは維持。追加分は追加時と同じく休憩に（プレイ中は据え置き）、外した分は削除時と
  同じく他の未成立予約に無く・プレイ中でなければ待機へ。消化済み・存在しない・全無効・変更なしは no-op。
  休憩化/解除は `computeAddReservation` / `computeRemoveReservation` とヘルパーを共用。
