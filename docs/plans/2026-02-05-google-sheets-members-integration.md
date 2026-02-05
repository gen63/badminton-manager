# Google Sheets メンバー読み込み機能

## 概要

セッション作成画面で、Google スプレッドシートの「当日参加者」シートから参加メンバーを読み込み、そのままセッションの参加者としてセットする機能。

**結論: 可能。既存の GAS 連携基盤を拡張するだけで実現できる。**

## アーキテクチャ

既存の GAS Web App（試合結果アップロード用 `doPost`）に `doGet` を追加し、同一URLでメンバー読み込みも行う。

```
読み込み（新規）:
┌─────────────┐   GET           ┌──────────────┐   読み取り   ┌────────────────────┐
│  アプリ      │ ←───────────── │  GAS Web App  │ ←────────── │ Google Spreadsheet │
│  (React)    │   JSON応答      │  doGet()      │             │ 「当日参加者」シート │
└─────────────┘                └──────────────┘             └────────────────────┘

書き込み（既存）:
┌─────────────┐   POST JSON    ┌──────────────┐   書き込み   ┌────────────────────┐
│  アプリ      │ ─────────────→ │  GAS Web App  │ ──────────→ │ Google Spreadsheet │
│  (React)    │                │  doPost()     │             │  試合結果シート     │
└─────────────┘                └──────────────┘             └────────────────────┘
```

- 同一 GAS URL で doGet / doPost を使い分け
- 追加設定不要（既存の GAS URL をそのまま利用）
- GAS Web App の GET リクエストは CORS 対応済み（レスポンス読み取り可能）

## スプレッドシートの「当日参加者」シート構成

ユーザーが「当日参加者」という名前のシートを作成し、当日の参加メンバーを記入。

| 列 | 内容 | 例 | 必須 |
|----|------|-----|------|
| A | 名前 | 田中太郎 | ○ |
| B | レーティング | 1500 | × |

- 1行目はヘッダー行（読み飛ばす）
- A列が空の行は無視
- B列が空または数値でない場合、レーティングなしとして扱う

**例:**
| 名前 | レーティング |
|------|------------|
| 田中太郎 | 1500 |
| 山田花子 | 1200 |
| 佐藤次郎 | |

## UXフロー

```
SessionCreate画面
┌──────────────────────────────┐
│  練習参加メンバー             │
│  ┌─────────────────────────┐ │
│  │ [Sheetsから読み込み]     │ │  ← GAS URL設定済みの場合のみ表示
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ 田中太郎  1500           │ │  ← 読み込んだメンバーがテキストエリアに入る
│  │ 山田花子  1200           │ │
│  │ 佐藤次郎                 │ │
│  │                         │ │
│  └─────────────────────────┘ │
│  1行に1人ずつ（任意）         │
└──────────────────────────────┘
```

1. ユーザーが「Sheetsから読み込み」ボタンをタップ
2. GAS経由でスプレッドシートの「当日参加者」シートからデータを取得
3. 取得したメンバーをテキストエリアに反映（既存入力は上書き）
4. 「開始」でセッション作成

**ポイント:**
- 「当日参加者」シートには当日参加するメンバーだけが載っている前提
- 読み込んだらそのまま開始できる（選択・削除は不要）
- 既存のテキストエリア入力パターンをそのまま活用
- 読み込み後も手動編集は可能

## GAS スクリプト変更

既存の `doPost` に加えて `doGet` を追加。

```javascript
// 新規追加: メンバー読み込み用
function doGet(e) {
  var sheetName = (e && e.parameter && e.parameter.sheet) || '当日参加者';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: 'シート「' + sheetName + '」が見つかりません' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var members = [];

  // 1行目はヘッダー、2行目以降がデータ
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0]).trim();
    if (!name) continue;

    var rating = parseInt(data[i][1], 10);
    var member = { name: name };
    if (!isNaN(rating)) {
      member.rating = rating;
    }
    members.push(member);
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', members: members })
  ).setMimeType(ContentService.MimeType.JSON);
}

// 既存: 試合結果書き込み用（変更なし）
function doPost(e) {
  // ... 既存コードそのまま
}
```

**注意:** `doGet` を追加した場合、GAS の再デプロイが必要（新しいバージョンとしてデプロイ）。

## フロントエンド実装

### 1. `src/lib/sheetsMembers.ts`（新規）

```typescript
interface MemberFromSheet {
  name: string;
  rating?: number;
}

interface FetchMembersResult {
  success: boolean;
  message: string;
  members: MemberFromSheet[];
}

export async function fetchMembersFromSheets(
  url: string
): Promise<FetchMembersResult> {
  // GAS URLにGETリクエスト
  // タイムアウト: 10秒
  // レスポンスJSON: { status: 'ok', members: [...] }
  // メンバーをテキスト形式に変換して返す
}

export function membersToText(members: MemberFromSheet[]): string {
  // 「名前  レーティング」形式のテキストに変換
  // レーティングなしの場合は名前のみ
}
```

### 2. `src/pages/SessionCreate.tsx`（変更）

- `useSettingsStore` から `gasWebAppUrl` を取得
- GAS URL設定済みの場合、テキストエリアの上に「Sheetsから読み込み」ボタンを表示
- ボタンタップで `fetchMembersFromSheets()` を呼び出し
- 結果をテキストエリアに反映
- ローディング状態・エラー表示を追加

### 3. `docs/gas-script.js`（変更）

- `doGet` 関数を追加
- 既存の `doPost` はそのまま維持

## 設定について

| 項目 | 方針 |
|------|------|
| GAS URL | 既存の `settingsStore.gasWebAppUrl` をそのまま利用 |
| シート名 | GAS側で「当日参加者」固定（クエリパラメータで変更可能） |
| 追加の設定UI | 不要（既存のGAS URL設定のみ） |

## 実装タスク

| # | タスク | ファイル | 内容 |
|---|--------|----------|------|
| 1 | GASスクリプト更新 | `docs/gas-script.js` | `doGet` 追加 |
| 2 | メンバー読み込みAPI | `src/lib/sheetsMembers.ts` | fetch関数・テキスト変換 |
| 3 | SessionCreate画面変更 | `src/pages/SessionCreate.tsx` | 読み込みボタン・ローディング・エラー表示 |
| 4 | ビルド確認 | - | `npm run build` |

## 設計判断

| 判断 | 理由 |
|------|------|
| 同一GAS URLでdoGet/doPostを共用 | 設定が1箇所で済む。URLの使い回し |
| テキストエリアへの反映（選択UIなし） | 既存パターン踏襲。シンプルで十分実用的 |
| 当日参加者シートに必要メンバーのみ記載 | 読み込み後の手動削除が不要。そのまま開始できる |
| シート名「当日参加者」固定 | 設定を増やさない。GAS側で変更可能 |
| GAS URL未設定時はボタン非表示 | 無駄なUIを見せない |
| CORS mode（no-corsではない） | GETレスポンスの中身を読む必要がある |
| GAS再デプロイが必要 | doGet追加は新バージョンのデプロイが必要。planに明記 |

## ユーザーへの運用手順

1. スプレッドシートに「当日参加者」シートを作成
2. 練習前に当日の参加者をA列に記入（B列にレーティング、任意）
3. GASスクリプトを更新（doGet追加）して再デプロイ
4. アプリのセッション作成画面で「Sheetsから読み込み」をタップ → そのまま開始
