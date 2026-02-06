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
 *
 * シート構成:
 * - 「当日結果」シート: 試合結果の書き込み先（doPost）。存在しない場合は自動作成
 * - 「当日参加者」シート: A列=名前, B列=レーティング（任意）。1行目はヘッダー
 */

/**
 * 当日参加者シートからメンバー一覧を返す
 * GET パラメータ sheet でシート名を変更可能（デフォルト: 当日参加者）
 */
function doGet(e) {
  try {
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

    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][0]).trim();
      if (!name) continue;

      var member = { name: name };
      var rating = parseInt(data[i][1], 10);
      if (!isNaN(rating)) {
        member.rating = rating;
      }
      members.push(member);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok', members: members })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message || '予期しないエラーが発生しました' })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 試合結果を「当日結果」シートに書き込む
 * シートが存在しない場合は自動作成する
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'リクエストデータがありません' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);

    if (!data.matches || !Array.isArray(data.matches)) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: '試合データの形式が不正です' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('当日結果');
    if (!sheet) {
      sheet = ss.insertSheet('当日結果');
    }

    data.matches.forEach(function (match) {
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
    });

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok', count: data.matches.length })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message || '予期しないエラーが発生しました' })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
