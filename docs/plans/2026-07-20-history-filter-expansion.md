# 試合履歴フィルタの拡充（成績サマリ + メンバー選択）

2026-07-20

## 背景 / 要望

履歴画面（`src/pages/HistoryPage.tsx`）には「自分の試合のみ」を絞り込む
トグルが既にある。これを 2 点拡充する。

1. **成績サマリの追加**: 自分の名前でフィルタしたとき、通算の勝敗数と勝率を
   試合一覧の下（入力済みセクションの下あたり）に表示する。
2. **メンバー選択の拡張**: 管理者以上の権限、または開発モードのときは、
   自分以外のメンバーも選んで絞り込めるようにする。

## 現状把握

- フィルタは `myMatchesOnly: boolean` + `currentUser` で「自分の試合のみ」を
  トグルしていた（`filterActive = canFilterByMe && myMatchesOnly`）。
- 対象判定は `isMatchOfPlayer(match, name, players)`（`src/lib/matchFilter.ts`）。
  名前ベース一致。シングルスの空文字枠や、`players` 未存在 ID に対して安全。
- 権限: `sessionStore` の `isCreator()`（作成者のみ）/ `isAdmin()`
  （作成者 or `session.admins` or 開発モード）。開発モードでは両者 true。
- 勝敗は `Match.winner: 'A' | 'B' | undefined`。`undefined` は未入力。

## 設計

### 集計ロジック（`src/lib/matchFilter.ts` に追加）

UI から切り離してテスト可能にするため、純関数として実装する。

- `getMatchResultForPlayer(match, name, players): 'win' | 'loss' | null`
  - `winner` 無し（未入力）/ 不参加 / `name` が null → null。
  - `teamA` / `teamB` どちらに属していても正しく勝敗を返す。
- `computePlayerRecord(matches, name, players): PlayerRecord`
  - `{ wins, losses, total, winRate }`。未入力・不参加は total に含めない。
  - `winRate` は 0-100 の整数（四捨五入）。total が 0 のときは null。

### UI（`src/pages/HistoryPage.tsx`）

- state を `myMatchesOnly: boolean` → `filterPlayerName: string | null` に変更
  （null = フィルタ無し / 全試合）。
- フィルタ操作:
  - 一般ユーザー: 従来どおり「自分の試合のみ」トグル
    （`filterPlayerName` を `currentUser` ↔ null にトグル）。
  - 管理者以上 / 開発モード（`canSelectOthers = !!session && isAdmin()`）:
    プルダウンで「全員 / 自分 / 他メンバー」を選択。
- プルダウンの候補 `filterablePlayerNames`: 「試合に参加した人 + 自分」を名前で
  一意列挙し、自分を先頭・残りを五十音（localeCompare）順に並べる。
- 選択中メンバーが候補から消えた場合（管理者がそのメンバーの最後の試合を削除
  等）は `useEffect` でフィルタを解除する。controlled `<select>` の value が
  option 集合とずれるのを防ぐ。候補は常に `currentUser` を含むため自分選択時は
  解除されない。
- 成績サマリ `PlayerRecordSummary`: フィルタ中、試合一覧の下に
  「◯勝 ◯敗 勝率 ◯%」を表示。対象 0 件のときは勝率を「—」表示。

## 権限マッピング

- 「管理者以上の権限または開発モード」= store の `isAdmin()`。
  作成者・`session.admins`・開発モードを含むため、`|| devMode` の明示は不要。
- 試合削除ボタンは従来どおり作成者のみ（`canDelete = isCreator()`）。今回のフィルタ
  拡張とは独立。

## テスト

- `src/lib/matchFilter.test.ts` に `getMatchResultForPlayer` /
  `computePlayerRecord` のユニットテストを追加
  （teamA/teamB 勝敗、未入力・不参加除外、シングルス、勝率計算、null 入力）。

## 非対象 / 制限

- 集計はそのセッションの `matchHistory` に閉じる（過去セッション横断の通算は対象外）。
- 名前ベース一致のため、同名プレイヤーは区別できない（既存 `isMatchOfPlayer` の
  仕様を踏襲）。
