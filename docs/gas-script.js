/**
 * Badminton Manager → Google Sheets 連携用 GAS スクリプト
 *
 * 使い方:
 * 1. Google スプレッドシートを作成
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコードを貼り付けて保存
 * 4. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 5. 表示された URL をアプリの設定画面に入力
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  data.matches.forEach(function (match) {
    sheet.appendRow([
      match.date,
      match.gym,
      match.matchNumber,
      match.courtId,
      match.teamA[0],
      match.teamA[1],
      match.scoreA,
      match.scoreB,
      match.teamB[0],
      match.teamB[1],
      match.duration,
      match.startedAt,
      match.finishedAt,
    ]);
  });

  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', count: data.matches.length })
  ).setMimeType(ContentService.MimeType.JSON);
}
