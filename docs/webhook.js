/**
 * GAS Webhook - 統合エントリポイント
 *
 * このスクリプトは以下のリクエストを振り分けて処理します:
 * 1. LINE Bot (Messaging API Webhook)
 * 2. Badminton Manager (試合結果の書き込み)
 *
 * デプロイ: ウェブアプリとして公開（実行ユーザー: 自分、アクセス: 全員）
 */

// ===== エントリポイント（振り分けのみ）=====

/**
 * GET リクエスト
 * - action=readTmpSheet: tmpシートから参加者データを返す
 * - デフォルト: 当日参加者シートからメンバー一覧を返す
 */
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === 'readTmpSheet') {
      var sheetName = e.parameter.sheet;
      if (!sheetName) {
        return errorResponse_('sheet parameter required');
      }
      var participants = readTmpSheet_(sheetName);
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'ok', participants: participants })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // デフォルト: 当日参加者シート読み取り
    var sheetName = (e && e.parameter && e.parameter.sheet) || '当日参加者';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return errorResponse_('シート「' + sheetName + '」が見つかりません');
    }

    var data = sheet.getDataRange().getValues();
    var members = [];

    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][0]).trim();
      if (!name) continue;

      var member = { name: name };
      var gender = String(data[i][1]).trim();
      if (gender) {
        member.gender = gender;
      }
      var rating = parseFloat(data[i][2]);
      if (!isNaN(rating)) {
        member.rating = rating;
      }
      members.push(member);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok', members: members })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return errorResponse_(err.message || '予期しないエラーが発生しました');
  }
}

/**
 * POST リクエスト: リクエストの種類を判別して振り分け
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return errorResponse_('リクエストデータがありません');
    }

    var data = JSON.parse(e.postData.contents);

    // tmpシート作成リクエスト
    if (data.action === 'createTmpSheet') {
      var result = createOrUpdateTmpSheet_(data.sheet, data.participants);
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'ok', created: result.created, missingOrdering: result.missingOrdering, deleted: result.deleted })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // LINE Bot リクエスト判定（events 配列がある）
    if (data.events && Array.isArray(data.events)) {
      return handleLineBotRequest_(e, data);
    }

    // Badminton Manager リクエスト判定（matches 配列がある）
    if (data.matches && Array.isArray(data.matches)) {
      return handleBadmintonManagerRequest_(e, data);
    }

    // どちらでもない
    return errorResponse_('不明なリクエスト形式です');
  } catch (err) {
    return errorResponse_(err.message || '予期しないエラーが発生しました');
  }
}

// ============================================================
// Badminton Manager 処理
// ============================================================

const SHEET_RESULTS = '当日結果';
const RESULTS_HEADERS = ['日付', '場所', 'A1', 'A2', 'B1', 'B2', 'スコアA', 'スコアB', '試合時間', 'matchId'];
const RESULTS_MATCH_ID_COL = 10; // J列

/**
 * 試合結果を「当日結果」シートに書き込む（matchId による重複排除あり）
 */
function handleBadmintonManagerRequest_(e, data) {
  if (!data.matches || !Array.isArray(data.matches)) {
    return errorResponse_('試合データの形式が不正です');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ニックネーム→フルネームのマップを構築
  var nicknameMap = buildNicknameMap_(ss);

  var sheet = ss.getSheetByName(SHEET_RESULTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RESULTS);
  }

  ensureResultsHeader_(sheet);

  // 既存シートの matchId セットを構築
  var existingIds = readExistingMatchIds_(sheet);

  var newRows = [];
  var skipped = 0;
  data.matches.forEach(function (match) {
    var id = match.matchId ? String(match.matchId) : '';
    if (id && existingIds[id]) {
      skipped++;
      return;
    }
    if (id) existingIds[id] = true; // 同一ペイロード内の重複も弾く

    var a0 = nicknameMap[match.teamA[0]] || match.teamA[0];
    var a1 = nicknameMap[match.teamA[1]] || match.teamA[1];
    var b0 = nicknameMap[match.teamB[0]] || match.teamB[0];
    var b1 = nicknameMap[match.teamB[1]] || match.teamB[1];

    newRows.push([
      match.date,
      match.gym,
      a0,
      a1,
      b0,
      b1,
      match.scoreA,
      match.scoreB,
      match.duration,
      id,
    ]);
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, RESULTS_HEADERS.length)
      .setValues(newRows);
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'ok',
      count: data.matches.length,
      inserted: newRows.length,
      skipped: skipped,
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 「当日結果」シートにヘッダ行を保証する
 * - 完全に空のシート → ヘッダを書く
 * - ヘッダはあるが matchId 列が欠けている → J1 に 'matchId' を補う
 */
function ensureResultsHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, RESULTS_HEADERS.length).setValues([RESULTS_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  var firstCell = sheet.getRange(1, 1).getValue();
  if (!firstCell) {
    sheet.getRange(1, 1, 1, RESULTS_HEADERS.length).setValues([RESULTS_HEADERS]);
    return;
  }
  // matchId 列のヘッダが無ければ補充
  if (sheet.getRange(1, RESULTS_MATCH_ID_COL).getValue() !== 'matchId') {
    sheet.getRange(1, RESULTS_MATCH_ID_COL).setValue('matchId');
  }
}

/**
 * matchId 列から既存 ID の集合を返す（空セルは無視）
 */
function readExistingMatchIds_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var values = sheet.getRange(2, RESULTS_MATCH_ID_COL, lastRow - 1, 1).getValues();
  var set = {};
  for (var i = 0; i < values.length; i++) {
    var id = values[i][0];
    if (id) set[String(id)] = true;
  }
  return set;
}

/**
 * 当日結果シートの重複行を削除する（matchId + 内容ハイブリッド判定）
 * - matchId が同じ行は最初の1行だけ残す
 * - matchId 空の行は他列（日付/場所/選手/スコア/時間）の内容で判定
 * - matchId 持ちの行と matchId 空の行が同じ内容なら、後者を重複として削除
 * - 行の出現順を保ったまま、最初に見つかった行を残す
 */
function cleanupResultsDuplicates() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_RESULTS);
  if (!sheet) {
    ui.alert('「' + SHEET_RESULTS + '」シートが見つかりません');
    return;
  }

  ensureResultsHeader_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) {
    ui.alert('対象行がありません');
    return;
  }

  var totalDataRows = lastRow - 1;
  var values = sheet.getRange(2, 1, totalDataRows, RESULTS_HEADERS.length).getValues();
  var seenIds = {};
  var seenContents = {};
  var kept = [];
  var removed = 0;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var matchId = row[RESULTS_MATCH_ID_COL - 1];
    var idKey = matchId ? String(matchId) : '';
    var contentKey = rowContentKey_(row);

    var isDuplicate = (idKey && seenIds[idKey]) || seenContents[contentKey];
    if (isDuplicate) {
      removed++;
      continue;
    }
    if (idKey) seenIds[idKey] = true;
    seenContents[contentKey] = true;
    kept.push(row);
  }

  if (removed === 0) {
    ui.alert('重複は見つかりませんでした');
    return;
  }

  var resp = ui.alert(
    '重複削除の確認',
    totalDataRows + ' 行のうち ' + removed + ' 件の重複を削除します。よろしいですか？',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  if (kept.length > 0) {
    sheet.getRange(2, 1, kept.length, RESULTS_HEADERS.length).setValues(kept);
  }
  var rowsToDelete = totalDataRows - kept.length;
  if (rowsToDelete > 0) {
    sheet.deleteRows(2 + kept.length, rowsToDelete);
  }

  ui.alert(removed + ' 件の重複行を削除しました（残り ' + kept.length + ' 件）');
}

/**
 * 行の内容（matchId 列を除く全列）から重複判定用キーを生成
 */
function rowContentKey_(row) {
  var parts = [];
  for (var i = 0; i < RESULTS_HEADERS.length; i++) {
    if (i === RESULTS_MATCH_ID_COL - 1) continue;
    parts.push(String(row[i] == null ? '' : row[i]));
  }
  return parts.join('\x1f');
}

/**
 * スプレッドシートを開いた時にカスタムメニューを追加
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('バドミントン')
    .addItem('当日結果の重複を削除', 'cleanupResultsDuplicates')
    .addToUi();
}

// ============================================================
// LINE Bot 処理
// ============================================================

const SHEET_LINE = 'LINE連携';
const SHEET_PLAYERS = 'Players';

/**
 * LINE Bot Webhook ハンドラー
 */
function handleLineBotRequest_(e, data) {
  var events = data.events;
  if (!events || events.length === 0) return okResponse_();

  var event = events[0];

  // テキストメッセージ以外は無視
  if (event.type !== 'message' || event.message.type !== 'text') return okResponse_();

  var text = event.message.text.trim();
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
  var userId = event.source.userId;

  // 登録フロー: 「マイページ連携希望」+ フルネーム
  if (lines[0] === 'マイページ連携希望' && lines[1]) {
    registerByFullName_(event, userId, lines[1]);
    return okResponse_();
  }

  // マイページ URL 取得
  if (text === 'マイページ') {
    replyMyPageUrl_(event, userId);
    return okResponse_();
  }

  // それ以外 → 何もしない
  return okResponse_();
}

// ===== LINE Bot: 登録処理 =====

function registerByFullName_(event, userId, inputName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 既に登録済みか確認
  var existing = findByLineUserId_(ss, userId);
  if (existing) {
    replyText_(event,
      existing.nickname + 'さん、既に連携済みです。\n\n' +
      '「マイページ」と送信するとURLを確認できます。');
    return;
  }

  // フルネームで Players シートを検索
  var normalized = normalize_(inputName);
  var playersSheet = ss.getSheetByName(SHEET_PLAYERS);
  var data = playersSheet.getDataRange().getValues();
  var found = null;

  for (var i = 1; i < data.length; i++) {
    if (normalize_(String(data[i][1])) === normalized && normalized !== '') {
      found = { nickname: data[i][0], fullName: data[i][1], rowIndex: i };
      break;
    }
  }

  if (!found) {
    replyText_(event,
      '該当する名前が見つかりません。\n' +
      '登録されているフルネームを正確に入力してください。');
    return;
  }

  // 同じニックネームが既に別の LINE ID で登録されていないか
  var existingNickname = findByNickname_(ss, found.nickname);
  if (existingNickname) {
    replyText_(event,
      'このお名前は既に別のアカウントで連携済みです。\n' +
      '心当たりがない場合は管理者にご連絡ください。');
    return;
  }

  // LINE連携シートに保存
  var lineSheet = getOrCreateLineSheet_(ss);
  lineSheet.appendRow([userId, found.nickname, found.fullName, new Date(), 'active']);

  // マイページ URL を返す
  var myPageId = data[found.rowIndex][16]; // 列Q = 公開マイページID
  if (myPageId) {
    var url = buildNotionUrl_(myPageId);
    replyText_(event,
      found.nickname + 'さん、連携が完了しました！\n\n' +
      '📊 あなたのマイページ:\n' + url + '\n\n' +
      '次回から「マイページ」と送信するだけでURLを確認できます。');
  } else {
    replyText_(event,
      found.nickname + 'さん、連携が完了しました！\n\n' +
      'マイページはまだ作成されていません。\n' +
      '次回の更新後に「マイページ」と送信してご確認ください。');
  }
}

// ===== LINE Bot: マイページ URL 返信 =====

function replyMyPageUrl_(event, userId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var linked = findByLineUserId_(ss, userId);

  if (!linked) {
    replyText_(event,
      'まだ連携されていません。\n\n' +
      '以下の形式で送信してください：\n\n' +
      'マイページ連携希望\nお名前（フルネーム）');
    return;
  }

  // Players シートからマイページ URL を取得（フルネームで検索、ニックネーム変更に強い）
  var playersSheet = ss.getSheetByName(SHEET_PLAYERS);
  var data = playersSheet.getDataRange().getValues();
  var myPageId = null;
  var currentNickname = linked.nickname;

  for (var i = 1; i < data.length; i++) {
    if (normalize_(String(data[i][1])) === normalize_(linked.fullName)) {
      myPageId = data[i][16]; // 列Q = 公開マイページID
      currentNickname = data[i][0]; // 現在のニックネーム（変更後の最新値）
      break;
    }
  }

  if (myPageId) {
    var url = buildNotionUrl_(myPageId);
    replyText_(event, '📊 ' + currentNickname + 'さんのマイページ:\n' + url);
  } else {
    replyText_(event,
      'マイページはまだ作成されていません。\n' +
      '次回の更新後に再度お試しください。');
  }
}

// ===== LINE Bot: ユーティリティ =====

function findByLineUserId_(ss, userId) {
  var sheet = ss.getSheetByName(SHEET_LINE);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId && data[i][4] === 'active') {
      return { nickname: data[i][1], fullName: data[i][2] };
    }
  }
  return null;
}

function findByNickname_(ss, nickname) {
  var sheet = ss.getSheetByName(SHEET_LINE);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === nickname && data[i][4] === 'active') {
      return { userId: data[i][0], nickname: data[i][1] };
    }
  }
  return null;
}

function getOrCreateLineSheet_(ss) {
  var existing = ss.getSheetByName(SHEET_LINE);
  if (existing) return existing;

  var sheet = ss.insertSheet(SHEET_LINE);
  var headers = ['LINE userID', 'ニックネーム', 'フルネーム', '登録日時', 'ステータス'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#06c755')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function normalize_(name) {
  return String(name).replace(/[\s\u3000]/g, '');
}

function buildNicknameMap_(ss) {
  var playersSheet = ss.getSheetByName(SHEET_PLAYERS);
  if (!playersSheet) return {};
  var data = playersSheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var nickname = String(data[i][0]).trim();
    var fullName = String(data[i][1]).trim();
    if (nickname && fullName) {
      map[nickname] = fullName;
    }
  }
  return map;
}

function buildNotionUrl_(pageId) {
  return 'https://www.notion.so/' + String(pageId).replace(/-/g, '');
}

function replyText_(event, text) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return;

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: text }],
    }),
    muteHttpExceptions: true,
  });
}

// ============================================================
// 共通ユーティリティ
// ============================================================

function okResponse_() {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function errorResponse_(message) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'error', message: message })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// tmpシート操作（セッション自動作成用）
// 列構成: [0]eventId [1]name [2]gender [3]ordering
// ============================================================

/**
 * Playersシートからニックネーム→デフォルト序列のMapを返す
 * Players列D(index 3) = skill を序列として使用
 */
function getDefaultOrderingMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PLAYERS);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0]).trim();
    var ordering = data[i][3];
    if (name && ordering) {
      map[name] = ordering;
    }
  }
  return map;
}

/**
 * tmpシートを作成または更新する
 * - シートが無ければ新規作成
 * - 既存シートなら管理者の入力を保持し、新規参加者のみ追加
 * - Playersシートのデフォルト序列で自動補完
 */
function createOrUpdateTmpSheet_(sheetName, participants) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  var orderingMap = getDefaultOrderingMap_();
  var isNew = !sheet;

  if (isNew) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['eventId', 'name', 'gender', 'ordering']);
    sheet.setFrozenRows(1);
  }

  // 既存行のキーを収集
  var existingKeys = {};
  if (!isNew) {
    var existingData = sheet.getDataRange().getValues();
    for (var i = 1; i < existingData.length; i++) {
      existingKeys[existingData[i][0] + '::' + existingData[i][1]] = true;
    }
  }

  // 新規参加者を一括追加
  var newRows = [];
  participants.forEach(function(p) {
    var key = p.eventId + '::' + p.name;
    if (existingKeys[key]) return;
    var defaultOrdering = orderingMap[p.name] || '';
    newRows.push([p.eventId, p.name, p.gender || '', defaultOrdering]);
  });
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }

  // シート全体をスキャンして序列未設定を収集
  var allData = sheet.getDataRange().getValues();
  var missingOrdering = [];
  for (var i = 1; i < allData.length; i++) {
    if (!allData[i][3]) {
      missingOrdering.push(allData[i][1]);
    }
  }

  // 過去日の古い tmp シートを自動削除（タブ増殖の抑制）
  var deleted = cleanupOldTmpSheets_(ss, sheetName);

  return { created: isNew, missingOrdering: missingOrdering, deleted: deleted };
}

/**
 * tmp_MMDD シートのうち、日付が「今日(JST)」より前のものを削除する。
 * - tmp シートの序列/性別はセッション作成時に Firestore へ読み込まれるため、
 *   イベントが過去になった tmp シートは破棄してよい。
 * - 当日・未来の予定シート、および今作成/更新したシート(keepSheetName)は残す
 *   ので、保留中（序列未入力・手動リラン待ち）の入力は消えない。
 * @param {Spreadsheet} ss 対象スプレッドシート
 * @param {string} keepSheetName 削除対象から必ず除外するシート名
 * @return {string[]} 削除したシート名の配列
 */
function cleanupOldTmpSheets_(ss, keepSheetName) {
  // JST の「今日」を 0 時基準の Date として求める
  var todayParts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd').split('/');
  var today = new Date(
    parseInt(todayParts[0], 10),
    parseInt(todayParts[1], 10) - 1,
    parseInt(todayParts[2], 10)
  );
  var todayYear = today.getFullYear();
  var DAY_MS = 86400000;

  var deleted = [];
  // 反復中に削除するため、シート配列を先に確保しておく
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name === keepSheetName) continue;

    var m = name.match(/^tmp_(\d{2})(\d{2})$/);
    if (!m) continue;

    var mm = parseInt(m[1], 10);
    var dd = parseInt(m[2], 10);

    // MMDD に年が無いので、今日に最も近い年を推定（±180日を超えたら補正）
    var candidate = new Date(todayYear, mm - 1, dd);
    if ((candidate - today) / DAY_MS > 180) {
      candidate = new Date(todayYear - 1, mm - 1, dd);
    } else if ((today - candidate) / DAY_MS > 180) {
      candidate = new Date(todayYear + 1, mm - 1, dd);
    }

    // 今日より厳密に前（イベントが過去）なら削除
    if (candidate < today) {
      ss.deleteSheet(sheets[i]);
      deleted.push(name);
    }
  }

  return deleted;
}

/**
 * tmpシートの全行を読み取る
 */
function readTmpSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    results.push({
      eventId: data[i][0],
      name: data[i][1],
      gender: data[i][2] || '',
      ordering: data[i][3] ? Number(data[i][3]) : null
    });
  }
  return results;
}
