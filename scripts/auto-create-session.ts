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
 *   MODE               - 'test'なら直近練習日を対象にセッション作成（デフォルト: 'production'）
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
}

interface MemberData {
  rating?: number;
  gender?: 'M' | 'F';
}

interface PlayerIssue {
  name: string;
  reason: string;
}

// ============================================================
// Phase A: E-tomoスクレイピング
// ============================================================

export { parseEventTitle, parseEventList, parseEventDetail, filterEventsByDate, findNextPracticeDate, checkPlayerIssues, decodeHtmlEntities, formatEventSummary, buildSessionData, formatPracticeDate, buildPracticeStartTime, isPracticeEvent };

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

  // 末尾の日付表記 "(4/12)" などを除去
  const venueNote = match[5].replace(/\(\d{1,2}\/\d{1,2}\)$/, '');
  const dotIndex = venueNote.lastIndexOf('.');

  return {
    month: parseInt(match[1]),
    day: parseInt(match[2]),
    startTime: match[3],
    endTime: match[4],
    venue: dotIndex >= 0 ? venueNote.substring(0, dotIndex) : venueNote,
    note: dotIndex >= 0 ? venueNote.substring(dotIndex + 1) : '',
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
  return /[単複楽]/.test(e.note) && !e.title.includes('目白');
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

/** 対象イベント（単/複/楽、目白除外）の中から今日以降で最も近い日付を探す */
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

function parseEventDetail(
  html: string,
): { location: string; participants: string[]; capacity: number | null } {
  const result = { location: '', participants: [] as string[], capacity: null as number | null };

  const locationMatch = html.match(/場所：([^<\n]+)/);
  if (locationMatch) {
    result.location = locationMatch[1].trim();
  }

  const capacityMatch = html.match(/人数[：:]\s*\d+\s*\/\s*(\d+)/);
  if (capacityMatch) {
    result.capacity = parseInt(capacityMatch[1]);
  }

  // 出席予定メンバーセクションから名前を抽出
  const memberSection = html.split('出席予定メンバー');
  if (memberSection.length >= 2) {
    const sectionHtml = memberSection[1].split('</div>')[1] || '';
    const nameMatches = sectionHtml.match(/<b>([^<]+)<\/b>/g);
    if (nameMatches) {
      result.participants = nameMatches.map((m) => {
        const name = m.replace(/<\/?b>/g, '');
        return decodeHtmlEntities(name.trim());
      });
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
      });
    } else {
      console.warn(`Failed to fetch detail for event ${event.eventId}`);
      results.push({ ...event, location: '', participants: [] });
    }
  }

  return results;
}

// ============================================================
// Phase C: スプレッドシートからメンバーデータ取得
// ============================================================

async function fetchMemberData(): Promise<Map<string, MemberData>> {
  const url = process.env.GAS_WEB_APP_URL;
  if (!url) {
    console.warn('GAS_WEB_APP_URL is not configured, skipping member data fetch');
    return new Map();
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`GAS fetch error: ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    members?: { name: string; rating?: number; gender?: string }[];
  };

  if (data.status === 'error' || !data.members) {
    throw new Error('GAS returned error or no members');
  }

  const memberMap = new Map<string, MemberData>();
  for (const m of data.members) {
    if (!m.name) continue;

    let gender: 'M' | 'F' | undefined;
    if (m.gender) {
      const g = String(m.gender).toUpperCase();
      if (g === 'M' || m.gender === '男') {
        gender = 'M';
      } else if (g === 'F' || m.gender === '女') {
        gender = 'F';
      }
    }

    memberMap.set(m.name, { rating: m.rating, gender });
  }

  console.log(`Fetched ${memberMap.size} members from Google Sheets`);
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
    if (!member) {
      issues.push({ name, reason: 'スプレッドシート未登録' });
    } else if (member.rating == null) {
      issues.push({ name, reason: 'レーティング未設定' });
    } else if (!member.gender) {
      issues.push({ name, reason: '性別未設定' });
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

function buildSessionData(
  event: EtomoEventDetail,
  memberMap: Map<string, MemberData>,
  targetDate: Date,
) {
  const practiceDate = formatPracticeDate(targetDate);
  const practiceStartTime = buildPracticeStartTime(targetDate, event.startTime);
  const gameMode = event.note === '単' ? 'singles' : 'doubles';

  const players = event.participants.map((name) => {
    const member = memberMap.get(name);
    return {
      id: crypto.randomUUID(),
      name,
      ...(member?.rating != null && { rating: member.rating }),
      ...(member?.gender && { gender: member.gender }),
      isResting: true,
      gamesPlayed: 0,
      lastPlayedAt: 0,
      activatedAt: 0,
    };
  });

  return {
    config: { courtCount: 1, targetScore: 15, practiceDate, practiceStartTime, gym: event.venue, gameMode },
    createdBy: 'auto-session-bot',
    participants: [] as string[],
    registeredPlayers: event.participants,
    status: 'active' as const,
    etomoEventId: event.eventId,
    gameState: {
      players,
      courts: [{ id: 1, teamA: ['', ''], teamB: ['', ''], scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0 }],
      matchHistory: [],
      reservations: [],
      settings: { practiceType: event.note as '単' | '複' | '楽' },
    },
  };
}

async function createFirestoreSession(
  db: ReturnType<typeof getFirestore>,
  event: EtomoEventDetail,
  memberMap: Map<string, MemberData>,
  targetDate: Date,
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

    const sessionData = buildSessionData(event, memberMap, targetDate);

    // sanitizeはundefined→除去だが、serverTimestamp()はFieldValueセンチネルなので除外して渡す
    const sanitize = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

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
  const noteLabel = event.note === '単' ? 'シングルス' : event.note === '複' ? 'ダブルス' : '楽ミント';
  return [
    `${targetDate.getMonth() + 1}/${targetDate.getDate()}(${dayName}) ${event.startTime}〜${event.endTime}`,
    `${event.venue}`,
    `${event.note}（${noteLabel}）`,
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
): Promise<void> {
  const summary = formatEventSummary(event, targetDate);
  const issueLines = issues.map((i) => `  • ${i.name} — ${i.reason}`).join('\n');
  const message = [
    '⚠️ **セッション作成保留（要確認）**',
    '━━━━━━━━━━━━━━━━━━',
    summary,
    '',
    '❓ **不明な参加者:**',
    issueLines,
    '',
    '📝 スプレッドシートを修正後、GitHub Actionsを手動実行してください',
  ].join('\n');

  await sendDiscordMessage(message);
}

async function notifyNoEvents(): Promise<void> {
  await sendDiscordMessage('ℹ️ 明日の開催予定はありません');
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

    for (const event of eventsWithDetails) {
      console.log(`\nProcessing: ${event.title}`);

      if (createdIds.has(event.eventId)) {
        console.log(`  -> Already created, skipping`);
        await notifySkipped(event, targetDate);
        continue;
      }

      const issues = checkPlayerIssues(event.participants, memberMap);

      if (issues.length > 0) {
        for (const issue of issues) {
          console.log(`     ${issue.name}: ${issue.reason}`);
        }

        if (!forceCreate) {
          console.log(`  -> Pending: ${issues.length} issue(s)`);
          await notifySessionPending(event, issues, targetDate);
          continue;
        }
        console.log(`  -> Force creating with ${issues.length} issue(s)`);
      }

      const sessionId = await createFirestoreSession(db, event, memberMap, targetDate);
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
  const isTestMode = process.env.MODE === 'test';

  console.log(`=== Auto Create Session ===`);
  console.log(`Mode: ${isTestMode ? 'test' : 'production'}`);
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

  // 対象日を決定: 本番は翌日、テストは直近練習日
  let targetDate: Date;
  if (isTestMode) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDate = findNextPracticeDate(allEvents, today);
    if (!nextDate) {
      console.log('No upcoming practice found.');
      return;
    }
    targetDate = nextDate;
    console.log(`[TEST] Target: ${formatPracticeDate(targetDate)} (直近練習日)`);
  } else {
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(0, 0, 0, 0);
  }

  const targetEvents = filterEventsByDate(allEvents, targetDate);
  console.log(`Target date events: ${targetEvents.length}`);

  if (targetEvents.length === 0) {
    if (!isTestMode) {
      console.log('No practice scheduled for tomorrow.');
      await notifyNoEvents();
    }
    return;
  }

  // Phase B + C: イベント詳細取得とスプレッドシート取得を並行実行
  console.log('\n--- Phase B+C: イベント詳細 & メンバーデータ取得 ---');
  const [eventsWithDetails, memberMap] = await Promise.all([
    fetchEventDetails(targetEvents, etomoUrl),
    fetchMemberData(),
  ]);

  for (const event of eventsWithDetails) {
    console.log(`  ${event.title}: ${event.participants.length} participants`);
  }

  // Phase D: セッション作成
  console.log('\n--- Phase D: セッション作成 ---');
  await processEvents(eventsWithDetails, memberMap, targetDate, forceCreate);

  console.log('\n=== Done ===');
}

// テスト時のモジュールインポートではmainを実行しない
const isDirectRun = process.argv[1]?.includes('auto-create-session') &&
  !process.argv[1]?.includes('.test.');

if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
