# 試合アップロードの重複排除

## 背景

- 現状、「試合履歴」画面のアップロードボタンを押すたびに、`matchHistory` 全件が GAS に送信され、`当日結果` シートに追記される
- フロントの `isUploading` フラグは連打を防ぐだけで、アップロード完了後に再度押すと全件がもう一度書き込まれる（別端末から同じセッションを開けば二重送信は簡単に起きる）
- GAS 側 (`docs/webhook.js:handleBadmintonManagerRequest_`) も無条件に `sheet.appendRow` するため、重複排除は一切ない

## ゴール

同じ `match.id` はスプレッドシートに二重に書き込まれない。端末・セッション再読込をまたいでも安定して効く。

## 方針

GAS シートに試合 ID を持たせて、サーバ側で重複を弾く。

- ペイロードに `matchId` を追加
- `当日結果` シートに `matchId` 列を追加（末尾列 = J列）
- GAS 側で書き込み前に既存シートの `matchId` セットを作り、既に存在する ID はスキップ
- 成功レスポンスに `inserted` / `skipped` 件数を含め、フロントでトーストに反映

## スコープ外

- 既存行の遡及対応（matchId が欠けている古い行）
  - 既存行は常に「空」扱い → 既存行があっても新規 ID なら普通に追加される。過去行の重複排除まではしない
- スコア修正後の再送で「旧行を上書きする」機能
  - 本 PR では「編集 → 再アップロード」は重複として **スキップ** される。上書き更新は別PRで検討
- 会計データ (`sendAccountingToSheets`) の重複排除
  - 用途が別（1セッション1件の運用）なので今回は触らない

## 変更点

### 1. `src/lib/sheetsApi.ts`

- `SheetMatch` インターフェースに `matchId: string` を追加
- `formatMatchesForSheets` で `matchId: match.id` を載せる
- `sendMatchesToSheets` の成功メッセージ生成を、レスポンスボディ（`inserted` / `skipped`）に基づいて組み立てる
  - ただし `mode: 'no-cors'` では `response.type === 'opaque'` でボディが読めないため、フロント側は従来通り件数ベースのメッセージのままでよい
  - → スコープを絞って、フロントの文言は現状維持。GAS レスポンスの構造だけ拡張しておく

### 2. `docs/webhook.js`

- `handleBadmintonManagerRequest_` を変更:
  1. `当日結果` シート末尾列 (matchId = 10列目) の既存値を一括取得し、`Set` に入れる
  2. ヘッダ行が未整備なら初回にヘッダを書く（`['日付','場所','A1','A2','B1','B2','スコアA','スコアB','試合時間','matchId']`）
  3. `data.matches` を走査し、`matchId` が空 or Set にない場合のみ `appendRow` の対象に追加
  4. まとめて `setValues` で一括書き込み（appendRow をループで叩くより速い）
  5. レスポンスに `{ status: 'ok', inserted: N, skipped: M, count: total }` を返す

### 3. スプレッドシート初期状態の扱い

- 既存シートにヘッダが無い / matchId 列が無い場合:
  - `getRange(1,1).getValue()` が空ならヘッダを書く
  - ヘッダはあるが matchId 列が欠けている場合は、J1 に `'matchId'` を補充
- 既存の空 matchId 行は無視（重複判定の Set に入らない）

## テスト戦略

- `src/lib/sheetsApi.ts` はペイロード生成のみの純粋関数を export 化するテストは今回追加しない（既存コードに `formatMatchesForSheets` 単体テストが無いため、スコープを広げ過ぎない）
- 手動確認項目:
  1. 新規セッションで数試合行い、1回目アップロード → `matchId` 列含めて正しく登録される
  2. 同じ状態で2回目アップロード → シートに新規行が追加されない
  3. 別端末で同セッションを開いてアップロード → 既存分はスキップ、増えた分だけ追加
  4. スコア編集して再アップロード → 重複としてスキップされる（＝現状 UX）
- ビルド・lint・テスト（`npm run build && npm run lint && npm run test:run`）が通ること

## ロールアウト手順

1. このブランチで実装・コミット
2. master にマージ → GitHub Pages は自動デプロイ
3. GAS Web App を手動再デプロイ（`docs/webhook.js` の内容を GAS エディタに反映）
4. 既存の `当日結果` シートには matchId 列（J列）を手動 or 初回 POST で追加
