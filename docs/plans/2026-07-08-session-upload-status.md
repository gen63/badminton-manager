# セッション一覧にアップロード済ステータスを表示（開発モード限定）

日付: 2026-07-08

## 背景 / 課題

試合結果アップロード（HistoryPage → GAS）と会計アップロード（AccountingPage →
GAS）は送信成功時に toast を出すだけで、**成功の記録がどこにも残らない**。
そのためセッション一覧・選択画面で「このセッションはアップロード済みか」を
判別できず、やり忘れに気付けない。

## 方針

検討した案（記録: Firestore / localStorage / GAS 照会、表示: 常時アイコン /
未実施のみ警告 / カード色）のうち、以下を採用:

- **記録 = Firestore session ドキュメントにアップロード記録を書く**
  - 真実のソースは Firestore という既存アーキテクチャに合致
  - どの端末からアップロードしても全員に同じ状態が見える
- **表示 = 未アップロードのときだけアンバーのバッジを出す（開発モード限定）**
  - 「やり忘れの発見」が目的なので、済んだものは何も表示しない
  - 通常ユーザーの見え方は一切変えない

## データモデル

`sessions/{id}` トップレベルに 2 フィールドを追加（`src/types/session.ts`）:

```ts
interface MatchUploadStatus {
  uploadedAt: number;   // アップロード成功時刻
  uploadedBy?: string;  // 実行者（currentUser があるときのみ）
  matchCount: number;   // アップロード時点の試合数（差分検出用）
}

interface AccountingUploadStatus {
  uploadedAt: number;
  uploadedBy?: string;
}

interface Session {
  // ...
  matchUpload?: MatchUploadStatus;
  accountingUpload?: AccountingUploadStatus;
}
```

- 書き込みは `updateSession()`（`information` 更新と同じ経路）。read → compute
  → write の競合がない単純な上書きなのでトランザクション不要。
- `uploadedBy` は undefined を含めると Firestore が例外を投げるため
  （ignoreUndefinedProperties 未設定）、currentUser があるときだけ差し込む。
- 記録の書き込み失敗はアップロード自体の成否と切り離し、warn ログのみ
  （アップロードは成功しているのに失敗 toast を出さない）。

## 表示ロジック（`src/lib/uploadStatus.ts`）

3 状態 + 会計の 2 値をヘルパー関数で判定:

| バッジ | 条件 |
|---|---|
| `試合未` | `matchCount > 0` かつ `matchUpload` なし |
| `試合差` | `matchUpload` あり かつ 現在の `matchCount > matchUpload.matchCount`（アップロード後に試合が増えた） |
| `会計未` | `accounting`（会計入力）あり かつ `accountingUpload` なし |

- 試合が 0 件のセッション、会計未入力のセッションでは対応するバッジを出さない
  （アップロードすべきものが無いため）。
- SessionSelectPage のカード 1 行目、既存の開発モード限定 💵 表示の隣に
  アンバーの小バッジとして表示。`devMode &&` で囲み通常モードには一切出さない。

## 変更ファイル

1. `src/types/session.ts` — `MatchUploadStatus` / `AccountingUploadStatus` 追加
2. `src/services/sessionService.ts` — `docToSession` で新フィールドをマップ
3. `src/lib/uploadStatus.ts` — バッジ判定ヘルパー（新規）
4. `src/lib/uploadStatus.test.ts` — ヘルパーのユニットテスト（新規）
5. `src/pages/HistoryPage.tsx` — アップロード成功時に `matchUpload` を記録
6. `src/pages/AccountingPage.tsx` — アップロード成功時に `accountingUpload` を記録
7. `src/pages/SessionSelectPage.tsx` — 開発モード時にバッジ表示

## 制限 / 注意

- GAS 送信は `mode: 'no-cors'`（opaque レスポンスを成功扱い）のため、記録される
  「済」は厳密には「送信できたはず」の意味。GAS 側の失敗は検出できない。
- 既存セッションにはフィールドが無いため全て「未」扱いから始まる（実態と一致）。
- 再アップロードすると記録は最新で上書きされる（履歴は持たない）。
