# データアップロードフォーマット修正

## 概要

Google Sheets へのアップロード（POST）のフォーマットが、あるべき形と一致していない問題を修正する。

## 現状

### フロントエンド送信（sheetsApi.ts）

`SheetMatch` インタフェースで 11 フィールドを送信：

```
date, gym, matchNumber, courtId, teamA[0], teamA[1], scoreA, scoreB, teamB[0], teamB[1], duration, startedAt, finishedAt
```

### GAS 書き込み（gas-script.js doPost）

13 列をスプレッドシートに書き込み：

```
date | gym | matchNumber | courtId | teamA[0] | teamA[1] | scoreA | scoreB | teamB[0] | teamB[1] | duration | startedAt | finishedAt
```

## あるべき形

CSVコピーと同じ 9 列フォーマット：

```
日付 | 場所 | A選手1 | A選手2 | B選手1 | B選手2 | スコアA | スコアB | 試合時間
```

## 差分

| 項目 | 現状 | 修正後 |
|------|------|--------|
| matchNumber | あり | **削除** |
| courtId | あり | **削除** |
| teamB の位置 | scoreA/scoreB の後 | scoreA/scoreB の **前** |
| startedAt | あり | **削除** |
| finishedAt | あり | **削除** |
| 列数 | 13 | **9** |

## 修正対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/lib/sheetsApi.ts` | `SheetMatch` から不要フィールド削除、列順序を修正 |
| `scripts/gas-script.js` | `doPost` の `appendRow` を 9 列に変更 |

## 実装

### sheetsApi.ts

`SheetMatch` インタフェースを以下に変更：

```typescript
interface SheetMatch {
  date: string;
  gym: string;
  teamA: [string, string];
  teamB: [string, string];
  scoreA: number;
  scoreB: number;
  duration: number;
}
```

`formatMatchesForSheets` から `matchNumber`, `courtId`, `startedAt`, `finishedAt` を削除。

### gas-script.js

`doPost` の `appendRow` を以下に変更：

```javascript
sheet.appendRow([
  match.date,
  match.gym,
  match.teamA[0],
  match.teamA[1],
  match.teamB[0],
  match.teamB[1],
  match.scoreA,
  match.scoreB,
  match.duration,
]);
```

## 注意

- `gas-script.js` を変更した場合、ユーザーは GAS エディタで再デプロイが必要
- CSV コピー（HistoryPage.tsx）は既にあるべき形なので変更不要
