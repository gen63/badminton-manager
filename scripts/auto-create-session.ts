/**
 * E-tomoスクレイピング → セッション自動作成スクリプト
 *
 * GitHub Actionsで毎日06:00 JST(21:00 UTC)に実行。
 * 翌日の開催予定をE-tomoから取得し、参加者情報をGoogleスプレッドシートで補完、
 * Firebaseにセッションを自動作成する。
 *
 * 環境変数:
 *   ETOMO_URL          - E-tomo認証付きURL
 *   GAS_WEB_APP_URL    - メンバーデータGAS Web App URL
 *   DISCORD_WEBHOOK_URL - Discord Webhook URL
 *   FORCE_CREATE       - 'true'なら不明点があっても強制作成
 *   TARGET_DATE        - 対象日（本番書き込みあり）。'nearest'=直近の練習日、それ以外(デフォルト)='tomorrow'=翌日
 *   VITE_FIREBASE_*    - Firebase設定
 *   TZ                 - Asia/Tokyo
 */

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import iconv from 'iconv-lite';

// ============================================================
// 型定義
// ============================================================

interface EtomoEvent {
  eventId: string;
  title: string;
  dateMonth: number;
  dateDay: number;
  startTime: string;
  endTime: string;
  venue: string;
  note: string;
  participantCount: number;
  capacity: number | null;
  waitlistCount: number;
}

interface EtomoEventDetail extends EtomoEvent {
  location: string;
  participants: string[];
  genders: Record<string, 'M' | 'F'>;
}

interface MemberData {
  ordering?: number;
  gender?: 'M' | 'F';
}

interface PlayerIssue {
  name: string;
  reason: string;
}

// ============================================================
// Phase A: E-tomoスクレイピング
// ============================================================

export { parseEventTitle, parseEventList, parseEventDetail, filterEventsByDate, findNextPracticeDate, checkPlayerIssues, decodeHtmlEntities, formatEventSummary, buildSessionData, formatPracticeDate, buildPracticeStartTime, isPracticeEvent, buildTmpSheetName, AUTO_SESSION_ADMINS };

async function fetchEtomoPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('E-ToMo fetch error:', response.status);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return iconv.decode(buffer, 'Shift_JIS');
  } catch (error) {
    console.error('E-ToMo fetch error:', error);
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseEventTitle(title: string) {
  const match = title.match(
    /(\d{1,2})\/(\d{1,2})\([^)]+\)(\d{1,2}:\d{2})[〜~～](\d{1,2}:\d{2})@(.+)/,
  );
  if (!match) return null;

  const venueNote = match[5].replace(/\(\d{1,2}\/\d{1,2}\)$/, '');
  const dotIndex = venueNote.lastIndexOf('.');

  const rawNote = dotIndex >= 0 ? venueNote.substring(dotIndex + 1) : '';
  // 「楽基礎」「楽初心」など `楽` で始まる細分類は `楽` として扱う
  const note = rawNote.startsWith('楽') ? '楽' : rawNote;

  return {
    month: parseInt(match[1]),
    day: parseInt(match[2]),
    startTime: match[3],
    endTime: match[4],
    venue: dotIndex >= 0 ? venueNote.substring(0, dotIndex) : venueNote,
    note,
  };
}

function parseEventList(html: string): EtomoEvent[] {
  const events: EtomoEvent[] = [];
  const blocks = html.split('class="user_event_list"');

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    const idMatch = block.match(/event_id=([^"&]+)/);
    if (!idMatch) continue;

    const titleMatch = block.match(/<b>([^<]+)<\/b>/);
    if (!titleMatch) continue;

    const title = titleMatch[1];
    const parsed = parseEventTitle(title);
    if (!parsed) continue;

    const countMatch = block.match(/人数[：:]\s*(\d+)\s*\/\s*(\d+)/);
    const waitlistMatch = block.match(/待[：:](\d+)/);

    events.push({
      eventId: idMatch[1],
      title,
      dateMonth: parsed.month,
      dateDay: parsed.day,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      venue: parsed.venue,
      note: parsed.note,
      participantCount: countMatch ? parseInt(countMatch[1]) : 0,
      capacity: countMatch ? parseInt(countMatch[2]) : null,
      waitlistCount: waitlistMatch ? parseInt(waitlistMatch[1]) : 0,
    });
  }

  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });
}

function isPracticeEvent(e: EtomoEvent): boolean {
  return e.note !== '周知' && e.note !== '協議会';
}

function filterEventsByDate(events: EtomoEvent[], targetDate: Date): EtomoEvent[] {
  const targetMonth = targetDate.getMonth() + 1;
  const targetDay = targetDate.getDate();

  return events.filter(
    (e) =>
      e.dateMonth === targetMonth &&
      e.dateDay === targetDay &&
      isPracticeEvent(e),
  );
}

/** 練習イベント（周知・協議会を除く）の中から今日以降で最も近い日付を探す */
function findNextPracticeDate(events: EtomoEvent[], today: Date): Date | null {
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  const todayYear = today.getFullYear();

  const practiceEvents = events.filter(isPracticeEvent);

  let nearest: Date | null = null;
  for (const e of practiceEvents) {
    // E-tomoにはyearが無いので推定
    let year = todayYear;
    const candidate = new Date(year, e.dateMonth - 1, e.dateDay);
    if ((candidate.getTime() - today.getTime()) / 86400000 < -30) {
      year++;
    }

    const eventDate = new Date(year, e.dateMonth - 1, e.dateDay);
    eventDate.setHours(0, 0, 0, 0);

    // 今日以降（当日含む）
    const todayStart = new Date(todayYear, todayMonth - 1, todayDay);
    todayStart.setHours(0, 0, 0, 0);
    if (eventDate < todayStart) continue;

    if (!nearest || eventDate < nearest) {
      nearest = eventDate;
    }
  }

  return nearest;
}

// ============================================================
// Phase B: イベント詳細（参加者リスト）取得
// ============================================================

function buildEventDetailUrl(listUrl: string, eventId: string): string {
  return listUrl.replace('event_info.php', 'event_detail.php') + '&event_id=' + eventId;
}

const GENDER_COLOR_MAP: Record<string, 'M' | 'F'> = {
  '#000080': 'M',
  '#ff1493': 'F',
};

function parseEventDetail(
  html: string,
): { location: string; participants: string[]; genders: Record<string, 'M' | 'F'>; capacity: number | null } {
  const result = {
    location: '',
    participants: [] as string[],
    genders: {} as Record<string, 'M' | 'F'>,
    capacity: null as number | null,
  };

  const locationMatch = html.match(/場所：([^<\n]+)/);
  if (locationMatch) {
    result.location = locationMatch[1].trim();
  }

  const capacityMatch = html.match(/人数[：:]\s*\d+\s*\/\s*(\d+)/);
  if (capacityMatch) {
    result.capacity = parseInt(capacityMatch[1]);
  }

  const memberSection = html.split('出席予定メンバー');
  if (memberSection.length >= 2) {
    const sectionHtml = memberSection[1].split('</div>')[1] || '';
    const fontColorRegex = /<font\s+color="([^"]*)"[^>]*>\s*<b>([^<]+)<\/b>/g;
    let match;
    while ((match = fontColorRegex.exec(sectionHtml)) !== null) {
      const color = match[1].toLowerCase();
      const name = decodeHtmlEntities(match[2].trim());
      result.participants.push(name);
      const gender = GENDER_COLOR_MAP[color];
      if (gender) {
        result.genders[name] = gender;
      }
    }
  }

  // コメントからビジター参加者を追加
  const commentMatches = html.match(/class="fukidasi_top">([^<]+)<\/div>/g);
  if (commentMatches) {
    const comments = commentMatches.map((m) => {
      const text = m.replace(/class="fukidasi_top">/, '').replace(/<\/div>/, '');
      return decodeHtmlEntities(text.trim());
    });
    comments.forEach((comment) => {
      if (
        (comment.includes('外部') || comment.includes('参加')) &&
        !result.participants.includes(comment)
      ) {
        result.participants.push(comment);
      }
    });
  }

  return result;
}

async function fetchEventDetails(
  events: EtomoEvent[],
  listUrl: string,
): Promise<EtomoEventDetail[]> {
  const results: EtomoEventDetail[] = [];

  for (let i = 0; i < events.length; i++) {
    if (i > 0) await sleep(500);

    const event = events[i];
    const detailUrl = buildEventDetailUrl(listUrl, event.eventId);
    const detailHtml = await fetchEtomoPage(detailUrl);

    if (detailHtml) {
      const detail = parseEventDetail(detailHtml);
      results.push({
        ...event,
        location: detail.location,
        participants: detail.participants,
        genders: detail.genders,
      });
    } else {
      console.warn(`Failed to fetch detail for event ${event.eventId}`);
      results.push({ ...event, location: '', participants: [], genders: {} });
    }
  }

  return results;
}

// ============================================================
// Phase C: tmpシート経由で序列データを取得
// ============================================================

function buildTmpSheetName(targetDate: Date): string {
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  return `tmp_${m}${d}`;
}

async function createTmpSheet(
  sheetName: string,
  events: EtomoEventDetail[],
): Promise<string[]> {
  const url = process.env.GAS_WEB_APP_URL;
  if (!url) {
    console.warn('GAS_WEB_APP_URL is not configured, skipping tmp sheet creation');
    return [];
  }

  const participants = events.flatMap((event) =>
    event.participants.map((name) => ({
      eventId: event.eventId,
      name,
      gender: event.genders[name] || '',
    })),
  );

  // GAS Web AppのPOSTは302リダイレクトを返す → redirect:'follow'で自動追従
  const payload = JSON.stringify({ action: 'createTmpSheet', sheet: sheetName, participants });
  const response = await fetch(url, {
    method: 'POST',
    body: payload,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });

  console.log(`[DEBUG] POST response: status=${response.status}, url=${response.url}, redirected=${response.redirected}`);
  const text = await response.text();
  let data: { status: string; created?: boolean; missingOrdering?: string[] };
  try {
    data = JSON.parse(text);
  } catch {
    console.log(`[DEBUG] Response body (first 500): ${text.substring(0, 500)}`);
    throw new Error(`GAS createTmpSheet returned non-JSON (status=${response.status})`);
  }

  if (data.status === 'error') {
    throw new Error('GAS createTmpSheet returned error');
  }

  console.log(`Tmp sheet "${sheetName}": ${data.created ? 'created' : 'updated'}, missing: ${data.missingOrdering?.length ?? 0}`);
  return data.missingOrdering ?? [];
}

async function readTmpSheet(
  sheetName: string,
): Promise<Map<string, MemberData>> {
  const url = process.env.GAS_WEB_APP_URL;
  if (!url) {
    console.warn('GAS_WEB_APP_URL is not configured, skipping tmp sheet read');
    return new Map();
  }

  const readUrl = `${url}?action=readTmpSheet&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(readUrl, { signal: AbortSignal.timeout(30000) });

  const data = (await response.json()) as {
    status: string;
    participants?: { eventId: string; name: string; gender: string; ordering: number | null }[];
  };

  if (data.status === 'error' || !data.participants) {
    throw new Error('GAS readTmpSheet returned error');
  }

  const memberMap = new Map<string, MemberData>();
  for (const p of data.participants) {
    if (!p.name) continue;
    memberMap.set(p.name, {
      ordering: p.ordering ?? undefined,
      gender: p.gender === 'M' || p.gender === 'F' ? p.gender : undefined,
    });
  }

  console.log(`Read ${memberMap.size} participants from tmp sheet "${sheetName}"`);
  return memberMap;
}

// ============================================================
// Phase D: セッション作成 & Discord通知
// ============================================================

function generateSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function checkPlayerIssues(
  participants: string[],
  memberMap: Map<string, MemberData>,
): PlayerIssue[] {
  const issues: PlayerIssue[] = [];
  for (const name of participants) {
    const member = memberMap.get(name);
    if (!member || member.ordering == null) {
      issues.push({ name, reason: '序列未設定' });
    }
  }
  return issues;
}

async function fetchCreatedEventIds(
  db: ReturnType<typeof getFirestore>,
  eventIds: string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  // Firestore 'in' クエリは最大30要素
  const created = new Set<string>();
  for (let i = 0; i < eventIds.length; i += 30) {
    const batch = eventIds.slice(i, i + 30);
    const q = query(collection(db, 'sessions'), where('etomoEventId', 'in', batch));
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((doc) => {
      const id = doc.data().etomoEventId;
      if (id) created.add(id);
    });
  }
  return created;
}

function buildPracticeStartTime(
  targetDate: Date,
  startTime: string,
): number {
  const [hours, minutes] = startTime.split(':').map(Number);
  const date = new Date(targetDate);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function formatPracticeDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 自動作成セッションで管理者権限を付与するメンバー候補（E-tomo上の表記と一致させること）
// 実際に admins に入るのは、このうち E-tomo の参加者に含まれるメンバーのみ
const AUTO_SESSION_ADMINS = [
  'げん',
  'まさ',
  'ゆーた(たっちゃん)',
  'ほそや',
  'かえで',
  'ツッキー',
  'あいだ',
  'りょーちん♂',
  'あら',
];

function buildSessionData(
  event: EtomoEventDetail,
  memberMap: Map<string, MemberData>,
  targetDate: Date,
  defaultAnnouncementText?: string,
) {
  const practiceStartTime = buildPracticeStartTime(targetDate, event.startTime);
  const gameMode = event.note === '単' ? 'singles' : 'doubles';

  const players = event.participants.map((name) => {
    const member = memberMap.get(name);
    const gender = event.genders[name] || member?.gender;
    // ordering=1（最強）→ rating=999（buildInitialOrderが降順ソートするため）
    const rating = member?.ordering != null ? 1000 - member.ordering : undefined;
    return {
      id: crypto.randomUUID(),
      name,
      ...(rating != null && { rating }),
      ...(gender && { gender }),
      isResting: true,
      gamesPlayed: 0,
      lastPlayedAt: 0,
      activatedAt: 0,
    };
  });

  const trimmedAnnouncement = defaultAnnouncementText?.trim() ?? '';

  return {
    config: { courtCount: 1, targetScore: 15, practiceStartTime, gym: event.venue, gameMode },
    createdBy: 'auto-session-bot',
    admins: AUTO_SESSION_ADMINS.filter((name) => event.participants.includes(name)),
    participants: [] as string[],
    registeredPlayers: event.participants,
    status: 'active' as const,
    etomoEventId: event.eventId,
    // デフォルト周知事項（appConfig/global）を周知事項としてコピー
    ...(trimmedAnnouncement
      ? { information: { text: trimmedAnnouncement, updatedAt: Date.now(), readBy: [] as string[] } }
      : {}),
    gameState: {
      players,
      courts: [{ id: 1, teamA: ['', ''], teamB: ['', ''], scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0 }],
      matchHistory: [],
      reservations: [],
      settings: {
        practiceType: event.note as '単' | '複' | '楽',
        recordScores: event.note !== '楽',
        continuousMatchMode: true,
      },
    },
  };
}

// undefined値を除去（serverTimestamp()等のセンチネル値はsanitize対象外にする）
const sanitize = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

/**
 * デフォルト周知事項（appConfig/global）を取得する。
 * 読めなくても（rules 未対応・未設定など）セッション作成は止めない。
 */
async function fetchDefaultAnnouncementText(
  db: ReturnType<typeof getFirestore>,
): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'appConfig', 'global'));
    if (!snap.exists()) return '';
    const text = (snap.data().defaultAnnouncement as { text?: string } | undefined)?.text;
    return typeof text === 'string' ? text.trim() : '';
  } catch (error) {
    console.warn('Failed to fetch default announcement, continuing without it:', error);
    return '';
  }
}

async function createFirestoreSession(
  db: ReturnType<typeof getFirestore>,
  event: EtomoEventDetail,
  memberMap: Map<string, MemberData>,
  targetDate: Date,
  defaultAnnouncementText: string,
): Promise<string> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const sessionId = generateSessionId();
    const docRef = doc(db, 'sessions', sessionId);

    const existingDoc = await getDoc(docRef);
    if (existingDoc.exists()) {
      console.warn(`Session ID collision: ${sessionId}, retrying...`);
      continue;
    }

    const sessionData = buildSessionData(event, memberMap, targetDate, defaultAnnouncementText);

    await setDoc(docRef, {
      ...sanitize({ id: sessionId, ...sessionData }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return sessionId;
  }

  throw new Error('Failed to generate unique session ID after 3 attempts');
}

// ============================================================
// Discord通知
// ============================================================

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatEventSummary(event: EtomoEventDetail, targetDate: Date): string {
  const dayName = DAY_NAMES[targetDate.getDay()];
  const noteLine =
    event.note === '単' ? '単（シングルス）'
    : event.note === '複' ? '複（ダブルス）'
    : event.note;
  return [
    `${targetDate.getMonth() + 1}/${targetDate.getDate()}(${dayName}) ${event.startTime}〜${event.endTime}`,
    `${event.venue}`,
    noteLine,
    `参加者: ${event.participants.length}名`,
  ].join('\n');
}

async function sendDiscordMessage(content: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[Discord] ' + content);
    return;
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

const SESSION_BASE_URL = 'https://gen63.github.io/badminton-manager/session';

async function notifySessionCreated(
  event: EtomoEventDetail,
  sessionId: string,
  targetDate: Date,
): Promise<void> {
  const summary = formatEventSummary(event, targetDate);
  const message = [
    '✅ **セッション作成完了**',
    '━━━━━━━━━━━━━━━━━━',
    summary,
    `セッションID: **${sessionId}**`,
    `${SESSION_BASE_URL}/${sessionId}`,
  ].join('\n');

  await sendDiscordMessage(message);
}

async function notifySessionPending(
  event: EtomoEventDetail,
  issues: PlayerIssue[],
  targetDate: Date,
  tmpSheetName: string,
): Promise<void> {
  const summary = formatEventSummary(event, targetDate);
  const issueNames = issues.map((i) => `  • ${i.name}`).join('\n');
  const message = [
    '⚠️ **セッション作成保留（要確認）**',
    '━━━━━━━━━━━━━━━━━━',
    summary,
    '',
    '❓ **序列未設定:**',
    issueNames,
    '',
    `📝 tmpシート「${tmpSheetName}」で序列を入力後、GitHub Actionsを手動実行してください`,
  ].join('\n');

  await sendDiscordMessage(message);
}

async function notifySkipped(event: EtomoEventDetail, targetDate: Date): Promise<void> {
  const summary = formatEventSummary(event, targetDate);
  const message = ['⏭️ **作成済みのためスキップ**', '━━━━━━━━━━━━━━━━━━', summary].join('\n');
  await sendDiscordMessage(message);
}

// ============================================================
// ユーティリティ
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

// ============================================================
// メイン
// ============================================================

async function processEvents(
  eventsWithDetails: EtomoEventDetail[],
  memberMap: Map<string, MemberData>,
  targetDate: Date,
  forceCreate: boolean,
  tmpSheetName: string,
) {
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
    const createdIds = await fetchCreatedEventIds(
      db,
      eventsWithDetails.map((e) => e.eventId),
    );
    const defaultAnnouncementText = await fetchDefaultAnnouncementText(db);
    if (defaultAnnouncementText) {
      console.log('Default announcement found, will be set on new sessions');
    }

    for (const event of eventsWithDetails) {
      console.log(`\nProcessing: ${event.title}`);

      if (createdIds.has(event.eventId)) {
        console.log(`  -> Already created, skipping`);
        await notifySkipped(event, targetDate);
        continue;
      }

      const issues = checkPlayerIssues(event.participants, memberMap);
      // 楽・単はレーティング不要なので未設定でも作成を保留しない
      const ratingRequired = event.note !== '楽' && event.note !== '単';

      if (issues.length > 0) {
        for (const issue of issues) {
          console.log(`     ${issue.name}: ${issue.reason}`);
        }

        if (!forceCreate && ratingRequired) {
          console.log(`  -> Pending: ${issues.length} issue(s)`);
          await notifySessionPending(event, issues, targetDate, tmpSheetName);
          continue;
        }
        console.log(`  -> Force creating with ${issues.length} issue(s)`);
      }

      const sessionId = await createFirestoreSession(db, event, memberMap, targetDate, defaultAnnouncementText);
      console.log(`  -> Session created: ${sessionId}`);
      await notifySessionCreated(event, sessionId, targetDate);
    }
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  const etomoUrl = requireEnv('ETOMO_URL');
  const forceCreate = process.env.FORCE_CREATE === 'true';
  const useNearestDate = process.env.TARGET_DATE === 'nearest';

  console.log(`=== Auto Create Session ===`);
  console.log(`Target date mode: ${useNearestDate ? 'nearest' : 'tomorrow'}`);
  console.log(`Force create: ${forceCreate}`);
  console.log(`Timezone: ${process.env.TZ || 'not set'}`);

  // Phase A: E-tomoイベント一覧取得
  console.log('\n--- Phase A: E-tomoイベント一覧取得 ---');
  const listHtml = await fetchEtomoPage(etomoUrl);
  if (!listHtml) {
    throw new Error('E-tomoイベント一覧の取得に失敗しました');
  }

  const allEvents = parseEventList(listHtml);
  console.log(`Total events found: ${allEvents.length}`);

  // 対象日を決定: tomorrowモードは翌日、nearestモードは直近練習日（どちらも本番同様に書き込む）
  let targetDate: Date;
  if (useNearestDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDate = findNextPracticeDate(allEvents, today);
    if (!nextDate) {
      console.log('No upcoming practice found.');
      return;
    }
    targetDate = nextDate;
    console.log(`[nearest] Target: ${formatPracticeDate(targetDate)} (直近練習日)`);
  } else {
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(0, 0, 0, 0);
  }

  const targetEvents = filterEventsByDate(allEvents, targetDate);
  console.log(`Target date events: ${targetEvents.length}`);

  if (targetEvents.length === 0) {
    if (!useNearestDate) {
      console.log('No practice scheduled for tomorrow.');
    }
    return;
  }

  // Phase B: イベント詳細取得（参加者名 + 性別）
  console.log('\n--- Phase B: イベント詳細取得 ---');
  const eventsWithDetails = await fetchEventDetails(targetEvents, etomoUrl);

  for (const event of eventsWithDetails) {
    console.log(`  ${event.title}: ${event.participants.length} participants`);
  }

  // Phase C: tmpシート作成 → 序列データ読み取り
  console.log('\n--- Phase C: tmpシート連携 ---');
  const tmpSheetName = buildTmpSheetName(targetDate);
  await createTmpSheet(tmpSheetName, eventsWithDetails);
  const memberMap = await readTmpSheet(tmpSheetName);

  // Phase D: セッション作成
  console.log('\n--- Phase D: セッション作成 ---');
  await processEvents(eventsWithDetails, memberMap, targetDate, forceCreate, tmpSheetName);

  console.log('\n=== Done ===');
}

// esm直接実行時のみmainを起動
const isDirectRun = process.argv[1]?.includes('auto-create-session') &&
  !process.argv[1]?.includes('.test.');

if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
