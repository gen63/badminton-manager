/**
 * E-ToMo 進行表への自動チェックイン（出席登録）スクリプト
 *
 * GitHub Actions で毎日 22:00 JST に実行。当日（JST）のセッションで実際に試合に出た人を、
 * E-ToMo の進行表から「出席登録」する。Firestore は読み取りのみ。
 * 詳細: docs/plans/2026-10-07-etomo-checkin.md
 *
 * 環境変数:
 *   ETOMO_CHECKIN_URL   - 進行表を操作できる認証付き event_info.php URL（任意・優先）
 *   ETOMO_URL           - 上記が無い場合に使う認証付き URL
 *   ETOMO_ADMIN_URL     - 管理者権限の認証付き URL（必須。メンバー一覧 user_list.php の取得に使う）
 *   DISCORD_WEBHOOK_URL - Discord Webhook URL
 *   DRY_RUN             - '1' / 'true' で「出席登録」ボタンを押さない
 *   TARGET_DATE         - 対象日 YYYY-MM-DD（未指定は今日 JST）
 *   VITE_FIREBASE_*     - Firebase 設定
 *   TZ                  - Asia/Tokyo
 *
 * 公開リポジトリのため、認証付き URL・ページ HTML はログに出さない。
 */

import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, getDocs, collection, query, where } from 'firebase/firestore';
import iconv from 'iconv-lite';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import type { GameState } from '../src/services/sessionService';
import {
  collectPlayedPlayerNames,
  parseProgressTable,
  parseUserListHtml,
  resolveRealNames,
  matchTargetsToRows,
  normalizeName,
  type EtomoUser,
  type ProgressRowRaw,
  type ProgressMemberRaw,
} from '../src/lib/etomoCheckin';
import { parseEventList, buildEventDetailUrl, fetchWithRetry, describeError } from './auto-create-session';

// ============================================================
// 型・定数
// ============================================================

interface TargetSession {
  sessionId: string;
  etomoEventId: string;
  playedNames: string[];
}

interface SessionResult {
  sessionId: string;
  title: string;
  registered: string[];
  /** 出席登録ボタンが無かった人（E-ToMo は2回登録できないため登録済みとみなす） */
  alreadyRegistered: string[];
  /** 「E-ToMo に見つからず未登録」として通知する文言（メンバー一覧に無い／進行表に無い） */
  notFound: string[];
  errors: string[];
  fatal?: string;
}

const PROGRESS_LINK_TEXT = 'このイベントの進行表を表示';
const SELECT_EVENT_TEXT = '対象イベントを選択してください';
const NAV_TIMEOUT_MS = 30000;
const USER_LIST_BASE = 'https://system.hawai-an.com/master/user_list.php';

/** 通知・ログ用: ニックネーム（本名） */
function label(nickname: string, realName: string): string {
  return normalizeName(nickname) === normalizeName(realName) ? realName : `${nickname}（${realName}）`;
}

// ============================================================
// ユーティリティ
// ============================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/** ログ用: クエリ（認証情報）を伏せた URL */
function redactUrl(url: string): string {
  const i = url.indexOf('?');
  return i < 0 ? url : `${url.slice(0, i)}?***`;
}

function resolveTargetDate(): string {
  const env = process.env.TARGET_DATE?.trim();
  if (env) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env)) throw new Error(`TARGET_DATE の形式が不正です: ${env}`);
    return env;
  }
  // 今日（JST）。TZ 指定に依存せず Asia/Tokyo で整形する
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

async function sendDiscordMessage(content: string): Promise<void> {
  const text = content.length > 1900 ? content.slice(0, 1900) + '\n…(省略)' : content;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[Discord] ' + text);
    return;
  }
  await fetchWithRetry(
    webhookUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    },
    'Discord webhook',
  );
}

// ============================================================
// Firestore（読み取りのみ）
// ============================================================

async function fetchTargetSessions(dateStr: string): Promise<TargetSession[]> {
  const app = initializeApp({
    apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
    authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('VITE_FIREBASE_APP_ID'),
  });
  const db = getFirestore(app);
  try {
    const start = new Date(`${dateStr}T00:00:00+09:00`).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const snapshot = await getDocs(
      query(
        collection(db, 'sessions'),
        where('config.practiceStartTime', '>=', start),
        where('config.practiceStartTime', '<', end),
      ),
    );
    const targets: TargetSession[] = [];
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const etomoEventId = data.etomoEventId as string | undefined;
      if (!etomoEventId) continue;
      const gameState = data.gameState as GameState | undefined;
      targets.push({
        sessionId: docSnap.id,
        etomoEventId,
        playedNames: gameState ? collectPlayedPlayerNames(gameState) : [],
      });
    }
    return targets;
  } finally {
    await deleteApp(app);
  }
}

// ============================================================
// E-ToMo（HTTP: イベントタイトル取得）
// ============================================================

async function fetchEventTitles(listUrl: string): Promise<Map<string, string>> {
  const response = await fetchWithRetry(listUrl, {}, 'E-ToMo event list');
  if (!response.ok) throw new Error(`E-ToMo イベント一覧の取得に失敗 (HTTP ${response.status})`);
  const html = iconv.decode(Buffer.from(await response.arrayBuffer()), 'Shift_JIS');
  return new Map(parseEventList(html).map((e) => [e.eventId, e.title]));
}

// ============================================================
// E-ToMo（Playwright）
// ============================================================

/** ETOMO_ADMIN_URL のクエリから gc= を除いて user_list.php の URL を作る */
function buildUserListUrl(adminUrl: string): string {
  const i = adminUrl.indexOf('?');
  const params = i < 0 ? [] : adminUrl.slice(i + 1).split('&').filter((p) => p && !p.startsWith('gc='));
  return params.length > 0 ? `${USER_LIST_BASE}?${params.join('&')}` : USER_LIST_BASE;
}

/**
 * メンバー一覧（ニックネーム ↔ 本名）を取得する。管理ページなので、進行表用とは別の
 * browser context で ETOMO_ADMIN_URL を先に開いて管理セッションを確保する
 * （メンバー用 URL で再認証すると権限不足になる）。
 */
async function fetchUserList(
  browser: Browser,
  adminUrl: string,
): Promise<EtomoUser[]> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    console.log(`Fetching member list (admin): ${redactUrl(adminUrl)}`);
    await gotoPage(page, adminUrl);
    const listUrl = buildUserListUrl(adminUrl);
    console.log(`Opening: ${redactUrl(listUrl)}`);
    await gotoPage(page, listUrl);
    return parseUserListHtml(await page.content());
  } finally {
    await context.close();
  }
}

async function gotoPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
}

/**
 * クリックしてページ遷移の完了を待つ。waitForLoadState は現ページが読み込み済みだと
 * 即座に解決してしまうため、遷移イベントそのものを待つ。
 */
async function clickAndWaitForNavigation(page: Page, target: Locator): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }),
    target.click(),
  ]);
}

/** イベント詳細 → 進行表 */
async function openProgressFromDetail(page: Page, detailUrl: string): Promise<void> {
  await gotoPage(page, detailUrl);
  await clickProgressLink(page);
}

async function clickProgressLink(page: Page): Promise<void> {
  const link = page.getByText(PROGRESS_LINK_TEXT).first();
  if ((await link.count()) === 0) throw new Error(`「${PROGRESS_LINK_TEXT}」が見つかりません`);
  await clickAndWaitForNavigation(page, link);
}

/**
 * 進行表を読み取る。名前セルのリンクに data-checkin-serial を付与する
 * （ページ遷移で消えるので、戻るたびに再実行する）。
 */
async function readProgress(
  page: Page,
): Promise<{ rows: ProgressRowRaw[]; members: ProgressMemberRaw[] }> {
  return await page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s　]+/g, ' ').trim();
    const rows: { serial: string; nameText: string }[] = [];

    // 見出しに「通番」を含むテーブル
    const tables = Array.from(document.querySelectorAll('table')).filter((t) =>
      Array.from(t.querySelectorAll('tr')).some((tr) => norm(tr.textContent).includes('通番')),
    );
    // 入れ子の外側テーブルを避け、最も内側のものを使う
    const table = tables.find((t) => !tables.some((o) => o !== t && t.contains(o)));
    if (table) {
      let serialIdx = -1;
      let nameIdx = -1;
      for (const tr of Array.from(table.querySelectorAll('tr'))) {
        const cells = Array.from(tr.children).filter((c) => /^(TD|TH)$/.test(c.tagName));
        if (serialIdx < 0) {
          const idx = cells.findIndex((c) => norm(c.textContent).includes('通番'));
          if (idx >= 0) {
            serialIdx = idx;
            nameIdx = cells.findIndex((c) => norm(c.textContent) === '名前');
            if (nameIdx < 0) nameIdx = cells.findIndex((c) => norm(c.textContent).includes('名前'));
          }
          continue;
        }
        if (nameIdx < 0 || cells.length <= Math.max(serialIdx, nameIdx)) continue;
        const serial = norm(cells[serialIdx].textContent);
        const link = cells[nameIdx].querySelector('a');
        if (!serial || !link) continue;
        link.setAttribute('data-checkin-serial', serial);
        rows.push({ serial, nameText: norm(link.textContent) });
      }
    }

    // 「参加予定メンバー」見出し以降の `<番号> <フルネーム>`
    const members: { no: string; fullName: string }[] = [];
    const text = document.body.innerText;
    const at = text.lastIndexOf('参加予定メンバー');
    if (at >= 0) {
      for (const line of text.slice(at).split('\n').slice(1)) {
        const m = line.trim().match(/^(\d+)[\s　]+(.+)$/);
        if (m) members.push({ no: m[1], fullName: m[2].trim() });
      }
    }
    return { rows, members };
  });
}

/** 名前リンクを押した後、イベント選択画面が出ていれば対象イベントを選ぶ */
async function selectEventIfAsked(page: Page, eventId: string, title: string): Promise<void> {
  if ((await page.getByText(SELECT_EVENT_TEXT).count()) === 0) return;

  const byId = page
    .locator(`a[href*="event_id=${eventId}"], [onclick*="event_id=${eventId}"], form[action*="event_id=${eventId}"] [type=submit]`)
    .first();
  let target = byId;
  if ((await byId.count()) === 0) {
    const byTitle = page
      .locator('a, button, input[type=button], input[type=submit]')
      .filter({ hasText: title })
      .first();
    const byValue = page.locator(`input[value="${title.replace(/"/g, '\\"')}"]`).first();
    if ((await byTitle.count()) > 0) target = byTitle;
    else if ((await byValue.count()) > 0) target = byValue;
    else throw new Error('イベント選択画面で対象イベントのボタンが見つかりません');
  }
  await clickAndWaitForNavigation(page, target);
}

/** 出欠実績・会費登録画面が想定の人・イベントか確認する */
async function verifyCheckinPage(page: Page, fullName: string, title: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const idx = text.indexOf('イベント情報');
  if (idx < 0) throw new Error('出欠登録画面に「イベント情報」が見つかりません');
  const head = normalizeName(text.slice(0, idx));
  if (!head.includes(`${normalizeName(fullName)}さん`)) {
    throw new Error('画面上の名前が想定と一致しません');
  }
  const after = normalizeName(text.slice(idx, idx + 400));
  if (!after.includes(normalizeName(title))) {
    throw new Error('画面上のイベント名が想定と一致しません');
  }
}

/**
 * 出欠登録画面のフォーム内「出席登録」ボタン（画面右下のナビリンクは除外）。
 * E-ToMo は同じ人を2回登録できず、登録済みだとボタンが出ない想定なので、
 * 見つからなければ null（＝登録済み）を返す。
 */
async function findAttendanceRegisterButton(page: Page): Promise<Locator | null> {
  const candidates = page.locator(
    'form input[type=submit][value="出席登録"], form button:has-text("出席登録"), form input[type=image][alt="出席登録"]',
  );
  return (await candidates.count()) > 0 ? candidates.first() : null;
}

async function processSession(
  page: Page,
  session: TargetSession,
  title: string,
  detailUrl: string,
  dryRun: boolean,
  users: EtomoUser[],
): Promise<SessionResult> {
  const result: SessionResult = {
    sessionId: session.sessionId,
    title,
    registered: [],
    alreadyRegistered: [],
    notFound: [],
    errors: [],
  };

  await openProgressFromDetail(page, detailUrl);
  const { rows: rawRows, members } = await readProgress(page);
  const rows = parseProgressTable(rawRows, members);
  if (rows.length === 0) {
    result.fatal = '進行表の構造を確認してください（通番と参加予定メンバーの対応が取れません）';
    return result;
  }

  // 進行表の参加者（本名）を先に確定し、メンバー一覧をその人たちに絞ってニックネームを引く
  const participantNames = rows.flatMap((r) => [r.fullName, r.displayName]);
  const { resolved: targets, unresolved } = resolveRealNames(session.playedNames, users, participantNames);
  result.notFound.push(...unresolved.map((n) => `${n}（当日の進行表にニックネームが一致する人がいない）`));
  const { toRegister, notFound } = matchTargetsToRows(rows, targets);
  result.notFound.push(...notFound.map((t) => `${label(t.name, t.realName)}（進行表に無い）`));
  console.log(
    `  対象 ${session.playedNames.length}名 / 本名解決 ${targets.length}名 / 進行表 ${rows.length}行 / 登録予定 ${toRegister.length}名 / 未解決 ${unresolved.length}名 / 進行表に無い ${notFound.length}名`,
  );

  for (const { row, nickname, realName } of toRegister) {
    const who = label(nickname, realName);
    try {
      // 進行表上でリンクを再取得（遷移で属性が消えるため毎回タグ付けし直す）
      const current = await readProgress(page);
      const exists = current.rows.some((r) => r.serial === row.serial);
      if (!exists) throw new Error('進行表に該当行が見つかりません');

      const link = page.locator(`[data-checkin-serial="${row.serial}"]`).first();
      await clickAndWaitForNavigation(page, link);
      await selectEventIfAsked(page, session.etomoEventId, title);
      await verifyCheckinPage(page, realName, title);

      const button = await findAttendanceRegisterButton(page);
      if (!button) {
        console.log(`  登録済み（出席登録ボタンなし）: ${who}`);
        result.alreadyRegistered.push(who);
      } else if (dryRun) {
        console.log(`  [DRY RUN] 登録予定: ${who}`);
        result.registered.push(who);
      } else {
        await clickAndWaitForNavigation(page, button);
        console.log(`  登録: ${who}`);
        result.registered.push(who);
      }
    } catch (error) {
      const message = `${who}: ${describeError(error)}`;
      console.error(`  エラー: ${message}`);
      result.errors.push(message);
    }

    // 進行表へ戻る（失敗時は詳細から開き直す）
    try {
      await clickProgressLink(page);
    } catch {
      try {
        await openProgressFromDetail(page, detailUrl);
      } catch (error) {
        result.fatal = `進行表に戻れなくなりました: ${describeError(error)}`;
        return result;
      }
    }
  }
  return result;
}

// ============================================================
// Discord 通知
// ============================================================

async function notifyResults(dateStr: string, dryRun: boolean, results: SessionResult[]): Promise<void> {
  const bullets = (names: string[]) => names.map((n) => `  • ${n}`).join('\n');
  const lines = [
    `${dryRun ? '[DRY RUN] ' : ''}🏸 **E-ToMo 出席登録** (${dateStr})`,
    '━━━━━━━━━━━━━━━━━━',
  ];
  for (const r of results) {
    lines.push('', `**${r.title}** (${r.sessionId})`);
    if (r.fatal) lines.push(`❌ ${r.fatal}`);
    lines.push(`${dryRun ? '登録予定' : '登録'}: ${r.registered.length}名`);
    if (r.registered.length > 0) lines.push(bullets(r.registered));
    if (r.alreadyRegistered.length > 0) {
      lines.push(`登録済みのためスキップ: ${r.alreadyRegistered.length}名`, bullets(r.alreadyRegistered));
    }
    if (r.notFound.length > 0) {
      lines.push('⚠️ E-ToMo に見つからず未登録:', bullets(r.notFound));
    }
    if (r.errors.length > 0) lines.push('❌ エラー:', bullets(r.errors));
  }
  await sendDiscordMessage(lines.join('\n'));
}

// ============================================================
// メイン
// ============================================================

async function main(): Promise<boolean> {
  const dryRun = isTruthyEnv(process.env.DRY_RUN);
  const dateStr = resolveTargetDate();
  const authUrl = process.env.ETOMO_CHECKIN_URL || requireEnv('ETOMO_URL');
  const adminUrl = requireEnv('ETOMO_ADMIN_URL');

  console.log('=== E-ToMo Checkin ===');
  console.log(`Target date: ${dateStr} / DRY_RUN: ${dryRun} / Timezone: ${process.env.TZ || 'not set'}`);

  const sessions = await fetchTargetSessions(dateStr);
  console.log(`Target sessions: ${sessions.length}`);
  if (sessions.length === 0) {
    console.log('対象セッションがありません。通知せず終了します。');
    return true;
  }

  const titles = await fetchEventTitles(authUrl);
  const results: SessionResult[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const users = await fetchUserList(browser, adminUrl);
    if (users.length === 0) {
      throw new Error('メンバー一覧を取得できません（ETOMO_ADMIN_URL を確認）。何も登録していません');
    }
    console.log(`Member list: ${users.length}名`);

    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    // 認証 URL を開いてセッション Cookie を確立
    console.log(`Authenticating: ${redactUrl(authUrl)}`);
    await gotoPage(page, authUrl);

    for (const session of sessions) {
      const title = titles.get(session.etomoEventId);
      console.log(`\nSession ${session.sessionId} (event ${session.etomoEventId}): ${title ?? '(タイトル不明)'}`);
      if (!title) {
        results.push({
          sessionId: session.sessionId,
          title: `event ${session.etomoEventId}`,
          registered: [],
          alreadyRegistered: [],
          notFound: [],
          errors: [],
          fatal: 'E-ToMo のイベント一覧にイベントが見つかりません',
        });
        continue;
      }
      if (session.playedNames.length === 0) {
        console.log('  試合に出た人がいないためスキップ');
        results.push({ sessionId: session.sessionId, title, registered: [], alreadyRegistered: [], notFound: [], errors: [] });
        continue;
      }
      try {
        const detailUrl = buildEventDetailUrl(authUrl, session.etomoEventId);
        results.push(await processSession(page, session, title, detailUrl, dryRun, users));
      } catch (error) {
        console.error(`  Fatal: ${describeError(error)}`);
        results.push({
          sessionId: session.sessionId,
          title,
          registered: [],
          alreadyRegistered: [],
          notFound: [],
          errors: [],
          fatal: describeError(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  await notifyResults(dateStr, dryRun, results);
  const hasError = results.some((r) => r.fatal || r.errors.length > 0);
  console.log('\n=== Done ===');
  return !hasError;
}

const isDirectRun =
  process.argv[1]?.includes('etomo-checkin') && !process.argv[1]?.includes('.test.');

if (isDirectRun) {
  main()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch(async (error) => {
      console.error('Fatal error:', describeError(error));
      try {
        await sendDiscordMessage(`❌ **E-ToMo 出席登録に失敗**\nエラー: ${describeError(error)}`);
      } catch (notifyError) {
        console.error('Failed to send failure notification:', describeError(notifyError));
      }
      process.exit(1);
    });
}
