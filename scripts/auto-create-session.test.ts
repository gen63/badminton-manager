import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseEventTitle,
  parseEventList,
  parseEventDetail,
  filterEventsByDate,
  findNextPracticeDate,
  checkPlayerIssues,
  isRatingRequired,
  findUnratedParticipants,
  decodeHtmlEntities,
  formatEventSummary,
  buildSessionData,
  formatPracticeDate,
  buildPracticeStartTime,
  buildTmpSheetName,
  computeRosterDiff,
  computeRosterSync,
  readTmpSheet,
  fetchWithRetry,
  fetchEventDetails,
  describeError,
} from './auto-create-session';
import iconv from 'iconv-lite';
import { buildInitialOrder } from '../src/lib/algorithm';
import type { Player } from '../src/types/player';

describe('parseEventTitle', () => {
  it('標準的なタイトルをパースできる', () => {
    const result = parseEventTitle('4/9(水)18:30〜21:30@千川館.複');
    expect(result).toEqual({
      month: 4,
      day: 9,
      startTime: '18:30',
      endTime: '21:30',
      venue: '千川館',
      note: '複',
    });
  });

  it('ノートが無い場合はvenueだけ返す', () => {
    const result = parseEventTitle('12/25(月)9:00〜12:00@体育館');
    expect(result).toEqual({
      month: 12,
      day: 25,
      startTime: '9:00',
      endTime: '12:00',
      venue: '体育館',
      note: '',
    });
  });

  it('チルダ(~)でも時間を分割できる', () => {
    const result = parseEventTitle('1/1(土)10:00~13:00@ぴいす.楽');
    expect(result).toEqual({
      month: 1,
      day: 1,
      startTime: '10:00',
      endTime: '13:00',
      venue: 'ぴいす',
      note: '楽',
    });
  });

  it('全角チルダ(～ U+FF5E)でも時間を分割できる', () => {
    const result = parseEventTitle('4/12(日)16:00～19:00@高松.複');
    expect(result).toEqual({
      month: 4,
      day: 12,
      startTime: '16:00',
      endTime: '19:00',
      venue: '高松',
      note: '複',
    });
  });

  it('末尾の日付表記を除去する', () => {
    const result = parseEventTitle('4/12(日)16:00～19:00@高松.複(4/12)');
    expect(result).toEqual({
      month: 4,
      day: 12,
      startTime: '16:00',
      endTime: '19:00',
      venue: '高松',
      note: '複',
    });
  });

  it('パース不能なタイトルはnullを返す', () => {
    expect(parseEventTitle('イベント名のみ')).toBeNull();
    expect(parseEventTitle('')).toBeNull();
  });

  it('会場名にドットが含まれる場合は最後のドットで分割', () => {
    const result = parseEventTitle('5/1(木)19:00〜21:00@A.B.単');
    expect(result).toEqual({
      month: 5,
      day: 1,
      startTime: '19:00',
      endTime: '21:00',
      venue: 'A.B',
      note: '単',
    });
  });

  it('「楽基礎」など `楽` で始まる細分類は `楽` に正規化する', () => {
    const result = parseEventTitle('6/8(月)18:30～21:30@富士見台.楽基礎');
    expect(result).toEqual({
      month: 6,
      day: 8,
      startTime: '18:30',
      endTime: '21:30',
      venue: '富士見台',
      note: '楽',
    });
  });
});

describe('parseEventList', () => {
  const sampleHtml = `
    <div>header</div>
    <div class="user_event_list">
      <a href="event_detail.php?event_id=123"><b>4/9(水)18:30〜21:30@千川館.複</b></a>
      人数：8/12 待:2
    </div>
    <div class="user_event_list">
      <a href="event_detail.php?event_id=456"><b>4/10(木)19:00〜21:00@高松.単</b></a>
      人数：5/8
    </div>
  `;

  it('イベント一覧をパースできる', () => {
    const events = parseEventList(sampleHtml);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      eventId: '123',
      title: '4/9(水)18:30〜21:30@千川館.複',
      dateMonth: 4,
      dateDay: 9,
      startTime: '18:30',
      endTime: '21:30',
      venue: '千川館',
      note: '複',
      participantCount: 8,
      capacity: 12,
      waitlistCount: 2,
    });
    expect(events[1].eventId).toBe('456');
    expect(events[1].waitlistCount).toBe(0);
  });

  it('重複eventIdを除去する', () => {
    const html = `
      <div class="user_event_list">
        <a href="?event_id=123"><b>4/9(水)18:30〜21:30@千川館.複</b></a>
      </div>
      <div class="user_event_list">
        <a href="?event_id=123"><b>4/9(水)18:30〜21:30@千川館.複</b></a>
      </div>
    `;
    expect(parseEventList(html)).toHaveLength(1);
  });

  it('空HTMLでは空配列を返す', () => {
    expect(parseEventList('')).toEqual([]);
    expect(parseEventList('<div>nothing</div>')).toEqual([]);
  });
});

describe('parseEventDetail', () => {
  it('参加者リストとフォント色から性別を抽出できる', () => {
    const html = `
      <div class="user_event_midashi">4/9(水)18:30〜21:30@千川館.複</div>
      場所：千川館体育館
      人数：3/12
      出席予定メンバー
      <div>header</div>
      <div><font color="#000080"><b>田中太郎</b></font><br><font color="#ff1493"><b>佐藤花子</b></font><br><font color="#000080"><b>山田次郎</b></font></div>
    `;
    const result = parseEventDetail(html);
    expect(result.location).toBe('千川館体育館');
    expect(result.capacity).toBe(12);
    expect(result.participants).toEqual(['田中太郎', '佐藤花子', '山田次郎']);
    expect(result.genders).toEqual({ '田中太郎': 'M', '佐藤花子': 'F', '山田次郎': 'M' });
  });

  it('HTMLエンティティをデコードする', () => {
    const html = `
      出席予定メンバー
      <div>header</div>
      <div><font color="#000080"><b>A&amp;B</b></font></div>
    `;
    const result = parseEventDetail(html);
    expect(result.participants).toEqual(['A&B']);
    expect(result.genders['A&B']).toBe('M');
  });

  it('コメントからビジター参加者を追加する', () => {
    const html = `
      出席予定メンバー
      <div>header</div>
      <div><font color="#000080"><b>田中太郎</b></font></div>
      <div class="fukidasi_top">外部ゲスト1名参加</div>
    `;
    const result = parseEventDetail(html);
    expect(result.participants).toContain('田中太郎');
    expect(result.participants).toContain('外部ゲスト1名参加');
  });

  it('出席予定メンバーセクションが無い場合は空配列', () => {
    const result = parseEventDetail('<div>nothing relevant</div>');
    expect(result.participants).toEqual([]);
    expect(result.genders).toEqual({});
    expect(result.location).toBe('');
    expect(result.capacity).toBeNull();
  });

  it('未知のフォント色でも参加者は抽出できる', () => {
    const html = `
      出席予定メンバー
      <div>header</div>
      <div><font color="#333333"><b>不明色さん</b></font></div>
    `;
    const result = parseEventDetail(html);
    expect(result.participants).toEqual(['不明色さん']);
    expect(result.genders).toEqual({});
  });
});

describe('filterEventsByDate', () => {
  const events = [
    { eventId: '1', title: '4/9(水)18:30〜21:30@千川館.複', dateMonth: 4, dateDay: 9, startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複', participantCount: 0, capacity: null, waitlistCount: 0 },
    { eventId: '2', title: '4/9(水)19:00〜21:00@高松.単', dateMonth: 4, dateDay: 9, startTime: '19:00', endTime: '21:00', venue: '高松', note: '単', participantCount: 0, capacity: null, waitlistCount: 0 },
    { eventId: '3', title: '4/10(木)18:30〜21:30@千川館.楽', dateMonth: 4, dateDay: 10, startTime: '18:30', endTime: '21:30', venue: '千川館', note: '楽', participantCount: 0, capacity: null, waitlistCount: 0 },
    { eventId: '4', title: '4/25(土)12:00〜14:00@目白.複', dateMonth: 4, dateDay: 25, startTime: '12:00', endTime: '14:00', venue: '目白', note: '複', participantCount: 0, capacity: null, waitlistCount: 0 },
    { eventId: '5', title: '4/9(水)18:00〜21:00@会議室.周知', dateMonth: 4, dateDay: 9, startTime: '18:00', endTime: '21:00', venue: '会議室', note: '周知', participantCount: 0, capacity: null, waitlistCount: 0 },
    { eventId: '6', title: '4/9(水)19:00〜21:00@会議室.協議会', dateMonth: 4, dateDay: 9, startTime: '19:00', endTime: '21:00', venue: '会議室', note: '協議会', participantCount: 0, capacity: null, waitlistCount: 0 },
  ];

  it('指定日の練習イベントを返す（周知・協議会は除外）', () => {
    const target = new Date(2026, 3, 9); // 4/9
    const filtered = filterEventsByDate(events, target);
    expect(filtered.map(e => e.eventId)).toEqual(['1', '2']);
  });

  it('目白会場のイベントも練習として含める', () => {
    const target = new Date(2026, 3, 25); // 4/25(土)
    const filtered = filterEventsByDate(events, target);
    expect(filtered.map(e => e.eventId)).toEqual(['4']);
  });

  it('周知のイベントは除外する', () => {
    const target = new Date(2026, 3, 9);
    const filtered = filterEventsByDate(events, target);
    expect(filtered.find(e => e.note === '周知')).toBeUndefined();
  });

  it('協議会のイベントは除外する', () => {
    const target = new Date(2026, 3, 9);
    const filtered = filterEventsByDate(events, target);
    expect(filtered.find(e => e.note === '協議会')).toBeUndefined();
  });

  it('該当日にイベントが無ければ空配列', () => {
    const target = new Date(2026, 3, 11); // 4/11
    expect(filterEventsByDate(events, target)).toEqual([]);
  });
});

describe('findNextPracticeDate', () => {
  const makeEvent = (month: number, day: number, note: string, title?: string) => ({
    eventId: `${month}-${day}`, title: title ?? `${month}/${day}(月)18:00〜21:00@千川館.${note}`,
    dateMonth: month, dateDay: day, startTime: '18:00', endTime: '21:00',
    venue: '千川館', note, participantCount: 0, capacity: null, waitlistCount: 0,
  });

  it('今日以降の直近練習日を返す', () => {
    const events = [makeEvent(4, 15, '複'), makeEvent(4, 12, '単'), makeEvent(4, 20, '楽')];
    const today = new Date(2026, 3, 10); // 4/10
    const result = findNextPracticeDate(events, today);
    expect(result).toEqual(new Date(2026, 3, 12)); // 4/12が最も近い
  });

  it('当日のイベントも対象に含める', () => {
    const events = [makeEvent(4, 10, '複')];
    const today = new Date(2026, 3, 10);
    const result = findNextPracticeDate(events, today);
    expect(result).toEqual(new Date(2026, 3, 10));
  });

  it('目白会場も練習として含める', () => {
    const events = [
      makeEvent(4, 11, '複', '4/11(土)12:00〜14:00@目白.複'),
      makeEvent(4, 15, '複'),
    ];
    const today = new Date(2026, 3, 10);
    const result = findNextPracticeDate(events, today);
    expect(result).toEqual(new Date(2026, 3, 11));
  });

  it('周知・協議会は除外する', () => {
    const events = [makeEvent(4, 10, '周知'), makeEvent(4, 12, '協議会'), makeEvent(4, 15, '楽')];
    const today = new Date(2026, 3, 10);
    const result = findNextPracticeDate(events, today);
    expect(result).toEqual(new Date(2026, 3, 15));
  });

  it('対象イベントが無ければnullを返す', () => {
    expect(findNextPracticeDate([], new Date(2026, 3, 10))).toBeNull();
  });

  it('過去のイベントしかない場合はnullを返す', () => {
    const events = [makeEvent(4, 5, '複')];
    const today = new Date(2026, 3, 10);
    expect(findNextPracticeDate(events, today)).toBeNull();
  });
});

describe('checkPlayerIssues', () => {
  const memberMap = new Map([
    ['田中太郎', { skill: 1, gender: 'M' as const }],
    ['佐藤花子', { skill: 2, gender: 'F' as const }],
    ['山田次郎', { skill: undefined, gender: 'M' as const }],
  ]);

  it('全員レーティングがあれば空配列', () => {
    expect(checkPlayerIssues(['田中太郎', '佐藤花子'], memberMap)).toEqual([]);
  });

  it('tmpシートに未登録の参加者を検出', () => {
    const issues = checkPlayerIssues(['未登録さん'], memberMap);
    expect(issues).toEqual([{ name: '未登録さん', reason: 'レーティング未設定' }]);
  });

  it('レーティング未設定を検出', () => {
    const issues = checkPlayerIssues(['山田次郎'], memberMap);
    expect(issues).toEqual([{ name: '山田次郎', reason: 'レーティング未設定' }]);
  });

  it('複数の問題を全て検出', () => {
    const issues = checkPlayerIssues(['田中太郎', '未登録さん', '山田次郎'], memberMap);
    expect(issues).toHaveLength(2);
  });
});

describe('decodeHtmlEntities', () => {
  it('数値エンティティをデコード', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
  });

  it('16進数エンティティをデコード', () => {
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
  });

  it('名前付きエンティティをデコード', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });

  it('エンティティが無い文字列はそのまま返す', () => {
    expect(decodeHtmlEntities('普通の文字列')).toBe('普通の文字列');
  });
});

describe('formatPracticeDate', () => {
  it('YYYY-MM-DD形式にフォーマット', () => {
    expect(formatPracticeDate(new Date(2026, 3, 9))).toBe('2026-04-09');
    expect(formatPracticeDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(formatPracticeDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('buildPracticeStartTime', () => {
  it('日付と時間文字列からUnixタイムスタンプを生成', () => {
    const date = new Date(2026, 3, 9); // 4/9
    const result = buildPracticeStartTime(date, '18:30');
    const expected = new Date(2026, 3, 9, 18, 30, 0, 0).getTime();
    expect(result).toBe(expected);
  });
});

describe('formatEventSummary', () => {
  it('イベントサマリーをフォーマット', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['A', 'B', 'C'], genders: {},
    };
    const date = new Date(2026, 3, 9); // 木曜日
    const summary = formatEventSummary(event, date);
    expect(summary).toContain('4/9(木)');
    expect(summary).toContain('18:30〜21:30');
    expect(summary).toContain('千川館');
    expect(summary).toContain('複（ダブルス）');
    expect(summary).toContain('3名');
  });

  it('シングルスのラベルが正しい', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '高松', note: '単',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    const summary = formatEventSummary(event, new Date(2026, 3, 9));
    expect(summary).toContain('単（シングルス）');
  });

  it('楽はラベル無しで `楽` のみ表示する', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: 'ぴいす', note: '楽',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    const summary = formatEventSummary(event, new Date(2026, 3, 9));
    expect(summary).toContain('\n楽\n');
  });
});

describe('buildSessionData', () => {
  it('セッションデータを正しく構築する（skill→rating変換）', () => {
    const event = {
      eventId: '123', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['田中太郎', '佐藤花子'],
      genders: { '田中太郎': 'M' as const, '佐藤花子': 'F' as const },
    };
    const memberMap = new Map([
      ['田中太郎', { skill: 1, gender: 'M' as const }],
      ['佐藤花子', { skill: 3, gender: 'F' as const }],
    ]);
    const date = new Date(2026, 3, 9);

    const data = buildSessionData(event, memberMap, date);
    expect(data.config.gym).toBe('千川館');
    expect(data.config.gameMode).toBe('doubles');
    expect(formatPracticeDate(new Date(data.config.practiceStartTime))).toBe('2026-04-09');
    expect(data.etomoEventId).toBe('123');
    expect(data.gameState.players).toHaveLength(2);
    expect(data.gameState.players[0].name).toBe('田中太郎');
    expect(data.gameState.players[0].rating).toBe(1); // skill をそのまま rating に
    expect(data.gameState.players[0].gender).toBe('M');
    expect(data.gameState.players[1].rating).toBe(3); // skill をそのまま rating に
    expect(data.gameState.players[0].isResting).toBe(true);
    expect(data.gameState.settings.practiceType).toBe('複');
    expect(data.gameState.settings.recordScores).toBe(true);
    expect(data.gameState.settings.continuousMatchMode).toBe(true);
  });

  it('skill が大きいメンバーほど buildInitialOrder で上位になる', () => {
    // skill は Players シート D 列の値をそのまま渡した値で、
    // 値が大きいほど強い（1〜N の順位ではないので小数も入る）。
    // かつてワイヤ上のフィールド名が ordering で、rating = 1000 - ordering
    // としており序列が反転していたため、「強い順に並ぶこと」を実際の
    // 並べ替え関数で検証する。
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '高松', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['最弱', '最強', '中位'], genders: {},
    };
    const memberMap = new Map([
      ['最弱', { skill: 1, gender: 'M' as const }],
      ['最強', { skill: 37.68, gender: 'M' as const }],
      ['中位', { skill: 26.17, gender: 'F' as const }],
    ]);

    const data = buildSessionData(event, memberMap, new Date(2026, 3, 9));
    const players = data.gameState.players as Player[];
    const orderedNames = buildInitialOrder(players).map(
      (id) => players.find((p) => p.id === id)!.name,
    );
    expect(orderedNames).toEqual(['最強', '中位', '最弱']);
  });

  it('シングルスのgameModeが正しい', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '高松', note: '単',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.config.gameMode).toBe('singles');
  });

  it('楽のときはrecordScoresがOFFになる', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '楽',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.gameState.settings.recordScores).toBe(false);
  });

  it('レーティング未設定の参加者はrating無し、性別はE-tomoから取得', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['未登録さん'],
      genders: { '未登録さん': 'F' as const },
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.gameState.players[0].name).toBe('未登録さん');
    expect(data.gameState.players[0]).not.toHaveProperty('rating');
    expect(data.gameState.players[0].gender).toBe('F');
  });

  it('デフォルト周知事項があればinformationとして設定する', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9), '体育館は土足厳禁です\n会費は現金で');
    expect(data.information).toBeDefined();
    expect(data.information?.text).toBe('体育館は土足厳禁です\n会費は現金で');
    expect(data.information?.readBy).toEqual([]);
    expect(typeof data.information?.updatedAt).toBe('number');
  });

  it('デフォルト周知事項が未設定・空白のみならinformationを含めない', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: [], genders: {},
    };
    expect(buildSessionData(event, new Map(), new Date(2026, 3, 9))).not.toHaveProperty('information');
    expect(buildSessionData(event, new Map(), new Date(2026, 3, 9), '')).not.toHaveProperty('information');
    expect(buildSessionData(event, new Map(), new Date(2026, 3, 9), '  \n ')).not.toHaveProperty('information');
  });

  it('参加者に含まれる管理者候補だけをadminsとして付与する', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['げん', 'りょーちん♂', '一般さん'], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.admins).toEqual(['げん', 'りょーちん♂']);
    expect(data.admins).not.toContain('一般さん');
  });

  it('参加者に管理者候補がいなければadminsは空になる', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['一般さん'], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.admins).toEqual([]);
  });

  it('createdByはAUTO_SESSION_ADMINSの序列で最上位の参加者になる', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['りょーちん♂', 'ほそや', '一般さん'], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.createdBy).toBe('ほそや');
  });

  it('管理者候補が参加者にいなければcreatedByはsentinelのまま', () => {
    const event = {
      eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['一般さん'], genders: {},
    };
    const data = buildSessionData(event, new Map(), new Date(2026, 3, 9));
    expect(data.createdBy).toBe('auto-session-bot');
    expect(data.admins).toEqual([]);
  });
});

describe('buildTmpSheetName', () => {
  it('tmp_MMDD形式でシート名を生成', () => {
    expect(buildTmpSheetName(new Date(2026, 3, 9))).toBe('tmp_0409');
    expect(buildTmpSheetName(new Date(2026, 0, 1))).toBe('tmp_0101');
    expect(buildTmpSheetName(new Date(2026, 11, 31))).toBe('tmp_1231');
  });
});

describe('computeRosterDiff', () => {
  it('追加のみ検出する', () => {
    expect(computeRosterDiff(['A', 'B'], ['A', 'B', 'C'])).toEqual({
      toAdd: ['C'],
      toRemove: [],
    });
  });

  it('削除のみ検出する', () => {
    expect(computeRosterDiff(['A', 'B', 'C'], ['A', 'B'])).toEqual({
      toAdd: [],
      toRemove: ['C'],
    });
  });

  it('追加と削除の両方を検出する', () => {
    expect(computeRosterDiff(['A', 'B'], ['B', 'C'])).toEqual({
      toAdd: ['C'],
      toRemove: ['A'],
    });
  });

  it('変化が無ければ両方とも空配列', () => {
    expect(computeRosterDiff(['A', 'B'], ['A', 'B'])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it('toAdd/toRemoveの順序はそれぞれの入力配列の出現順に従う', () => {
    expect(computeRosterDiff(['A', 'B', 'C'], ['D', 'C', 'B', 'E'])).toEqual({
      toAdd: ['D', 'E'],
      toRemove: ['A'],
    });
  });
});

describe('computeRosterSync', () => {
  const baseEvent = {
    eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
    startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
    participantCount: 0, capacity: null, waitlistCount: 0,
    location: '',
  };

  it('新規出席者が isResting: true / gamesPlayed: 0 等の初期値で追加され、memberMapからrating/genderが補完される', () => {
    const state = {
      players: [
        { id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 3, lastPlayedAt: 100, activatedAt: 50 },
      ],
      courts: [],
      matchHistory: [],
      reservations: [],
    };
    const event = { ...baseEvent, participants: ['田中太郎', '佐藤花子'], genders: { '佐藤花子': 'F' as const } };
    const memberMap = new Map([['佐藤花子', { skill: 2, gender: 'M' as const }]]);

    const { state: nextState, added, removed } = computeRosterSync(state, event, memberMap);

    expect(added).toEqual(['佐藤花子']);
    expect(removed).toEqual([]);
    expect(nextState.players).toHaveLength(2);
    const newPlayer = nextState.players.find((p) => p.name === '佐藤花子');
    expect(newPlayer).toBeDefined();
    expect(newPlayer?.isResting).toBe(true);
    expect(newPlayer?.gamesPlayed).toBe(0);
    expect(newPlayer?.lastPlayedAt).toBe(0);
    expect(newPlayer?.activatedAt).toBe(0);
    expect(newPlayer?.rating).toBe(2); // skill をそのまま rating に
    // genders は event.genders が memberMap より優先される
    expect(newPlayer?.gender).toBe('F');
    expect(typeof newPlayer?.id).toBe('string');
  });

  it('memberMapに無い場合はratingを持たない', () => {
    const state = { players: [], courts: [], matchHistory: [], reservations: [] };
    const event = { ...baseEvent, participants: ['未登録さん'], genders: {} };
    const { state: nextState } = computeRosterSync(state, event, new Map());
    expect(nextState.players[0]).not.toHaveProperty('rating');
    expect(nextState.players[0]).not.toHaveProperty('gender');
  });

  it('削除対象プレイヤーがコートのteamA/teamBから除去される', () => {
    const state = {
      players: [
        { id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
        { id: 'p2', name: '佐藤花子', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
      ],
      courts: [
        { id: 1, teamA: ['p1', 'p2'] as [string, string], teamB: ['', ''] as [string, string], scoreA: 0, scoreB: 0, isPlaying: true, startedAt: 0, finishedAt: 0 },
      ],
      matchHistory: [],
      reservations: [],
    };
    const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
    const { state: nextState, removed } = computeRosterSync(state, event, new Map());

    expect(removed).toEqual(['佐藤花子']);
    expect(nextState.players.map((p) => p.name)).toEqual(['田中太郎']);
    expect(nextState.courts[0].teamA).toEqual(['p1', '']);
  });

  it('削除対象プレイヤーがrestingPlayerIdsから除去される', () => {
    const state = {
      players: [
        { id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
        { id: 'p2', name: '佐藤花子', isResting: true, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
      ],
      courts: [
        { id: 1, teamA: ['', ''] as [string, string], teamB: ['', ''] as [string, string], scoreA: 0, scoreB: 0, isPlaying: false, startedAt: 0, finishedAt: 0, restingPlayerIds: ['p1', 'p2'] },
      ],
      matchHistory: [],
      reservations: [],
    };
    const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
    const { state: nextState } = computeRosterSync(state, event, new Map());

    expect(nextState.courts[0].restingPlayerIds).toEqual(['p1']);
  });

  it('削除により空になった予約は削除され、空にならない予約は該当IDだけ除去される', () => {
    const state = {
      players: [
        { id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
        { id: 'p2', name: '佐藤花子', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
        { id: 'p3', name: '山田次郎', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
      ],
      courts: [],
      matchHistory: [],
      reservations: [
        { id: 'r1', orderNumber: 1, playerIds: ['p2'], status: 'pending' as const, createdAt: 0, fulfilledAt: 0 },
        { id: 'r2', orderNumber: 2, playerIds: ['p1', 'p2'], status: 'pending' as const, createdAt: 0, fulfilledAt: 0 },
      ],
    };
    // p2, p3(未参加なので初めから対象外) を削除対象、p1のみ残す
    const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
    const { state: nextState, removed } = computeRosterSync(state, event, new Map());

    expect(removed.sort()).toEqual(['佐藤花子', '山田次郎'].sort());
    expect(nextState.reservations).toHaveLength(1);
    expect(nextState.reservations[0].id).toBe('r2');
    expect(nextState.reservations[0].playerIds).toEqual(['p1']);
  });

  it('matchHistoryは変更されない', () => {
    const match = { id: 'm1', courtId: 1, teamA: ['p1', 'p2'] as [string, string], teamB: ['p3', ''] as [string, string], scoreA: 15, scoreB: 10, startedAt: 0, finishedAt: 100 };
    const state = {
      players: [
        { id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 1, lastPlayedAt: 100, activatedAt: 0 },
        { id: 'p3', name: '山田次郎', isResting: false, gamesPlayed: 1, lastPlayedAt: 100, activatedAt: 0 },
      ],
      courts: [],
      matchHistory: [match],
      reservations: [],
    };
    const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
    const { state: nextState } = computeRosterSync(state, event, new Map());

    expect(nextState.matchHistory).toEqual([match]);
    expect(nextState.matchHistory).toBe(state.matchHistory);
  });

  it('変化が無ければaddedもremovedも空配列', () => {
    const state = {
      players: [{ id: 'p1', name: '田中太郎', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 }],
      courts: [],
      matchHistory: [],
      reservations: [],
    };
    const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
    const { added, removed } = computeRosterSync(state, event, new Map());
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  describe('留任プレイヤーのレーティング同期', () => {
    const stateWith = (players: { id: string; name: string; rating?: number }[]) => ({
      players: players.map((p) => ({
        ...p, isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0,
      })),
      courts: [],
      matchHistory: [],
      reservations: [],
    });

    it('tmpシートのskillが変わっていれば既存プレイヤーのratingを上書きする', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎', rating: 3 }]);
      const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
      const memberMap = new Map([['田中太郎', { skill: 7 }]]);

      const { state: nextState, ratingUpdated } = computeRosterSync(state, event, memberMap);

      expect(nextState.players[0].rating).toBe(7);
      expect(ratingUpdated).toEqual([{ name: '田中太郎', from: 3, to: 7 }]);
    });

    it('レート未設定だった既存プレイヤーにもskillが入る', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎' }]);
      const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
      const memberMap = new Map([['田中太郎', { skill: 5 }]]);

      const { state: nextState, ratingUpdated } = computeRosterSync(state, event, memberMap);

      expect(nextState.players[0].rating).toBe(5);
      expect(ratingUpdated).toEqual([{ name: '田中太郎', from: undefined, to: 5 }]);
    });

    it('skillが同値なら更新扱いにしない', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎', rating: 5 }]);
      const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
      const memberMap = new Map([['田中太郎', { skill: 5 }]]);

      const { ratingUpdated } = computeRosterSync(state, event, memberMap);
      expect(ratingUpdated).toEqual([]);
    });

    it('tmpシートにskillが無い人は既存ratingを維持する（消さない）', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎', rating: 4 }]);
      const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };

      const { state: nextState, ratingUpdated } = computeRosterSync(state, event, new Map());

      expect(nextState.players[0].rating).toBe(4);
      expect(ratingUpdated).toEqual([]);
    });

    it('syncExistingRatings: false（試合開始後）ではratingを変更しない', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎', rating: 3 }]);
      const event = { ...baseEvent, participants: ['田中太郎'], genders: {} };
      const memberMap = new Map([['田中太郎', { skill: 7 }]]);

      const { state: nextState, ratingUpdated } = computeRosterSync(state, event, memberMap, {
        syncExistingRatings: false,
      });

      expect(nextState.players[0].rating).toBe(3);
      expect(ratingUpdated).toEqual([]);
    });

    it('削除対象プレイヤーはレート更新の対象外', () => {
      const state = stateWith([{ id: 'p1', name: '田中太郎', rating: 3 }]);
      const event = { ...baseEvent, participants: [], genders: {} };
      const memberMap = new Map([['田中太郎', { skill: 7 }]]);

      const { ratingUpdated, removed } = computeRosterSync(state, event, memberMap);

      expect(removed).toEqual(['田中太郎']);
      expect(ratingUpdated).toEqual([]);
    });
  });

  describe('レート未設定の新規参加者の保留（holdUnratedAdditions）', () => {
    const emptyState = { players: [], courts: [], matchHistory: [], reservations: [] };

    it('holdUnratedAdditions: true ではレート未設定の新規参加者を追加しない', () => {
      const event = { ...baseEvent, participants: ['初参加さん', '常連さん'], genders: {} };
      const memberMap = new Map([['常連さん', { skill: 5 }]]);

      const { state: nextState, added, held } = computeRosterSync(emptyState, event, memberMap, {
        holdUnratedAdditions: true,
      });

      expect(added).toEqual(['常連さん']);
      expect(held).toEqual(['初参加さん']);
      expect(nextState.players.map((p) => p.name)).toEqual(['常連さん']);
    });

    it('holdUnratedAdditions: false（既定）では従来どおりレート無しでも追加する', () => {
      const event = { ...baseEvent, participants: ['初参加さん'], genders: {} };

      const { state: nextState, added, held } = computeRosterSync(emptyState, event, new Map());

      expect(added).toEqual(['初参加さん']);
      expect(held).toEqual([]);
      expect(nextState.players).toHaveLength(1);
    });

    it('保留があっても削除・レート更新は通常どおり行われる', () => {
      const state = {
        players: [
          { id: 'p1', name: '常連さん', rating: 3, isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
          { id: 'p2', name: '欠席さん', isResting: false, gamesPlayed: 0, lastPlayedAt: 0, activatedAt: 0 },
        ],
        courts: [],
        matchHistory: [],
        reservations: [],
      };
      const event = { ...baseEvent, participants: ['常連さん', '初参加さん'], genders: {} };
      const memberMap = new Map([['常連さん', { skill: 8 }]]);

      const { state: nextState, added, removed, held, ratingUpdated } = computeRosterSync(
        state, event, memberMap, { holdUnratedAdditions: true },
      );

      expect(added).toEqual([]);
      expect(removed).toEqual(['欠席さん']);
      expect(held).toEqual(['初参加さん']);
      expect(ratingUpdated).toEqual([{ name: '常連さん', from: 3, to: 8 }]);
      expect(nextState.players.map((p) => p.name)).toEqual(['常連さん']);
    });
  });
});

describe('isRatingRequired', () => {
  it('複はレーティング必須', () => {
    expect(isRatingRequired({ note: '複' })).toBe(true);
  });

  it('楽・単はレーティング不要', () => {
    expect(isRatingRequired({ note: '楽' })).toBe(false);
    expect(isRatingRequired({ note: '単' })).toBe(false);
  });
});

describe('findUnratedParticipants', () => {
  const baseEvent = {
    eventId: '1', title: 'test', dateMonth: 4, dateDay: 9,
    startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
    participantCount: 0, capacity: null, waitlistCount: 0, location: '',
    genders: {},
  };

  it('レート未設定の参加者のうち、今回保留した人を除いて返す', () => {
    const event = { ...baseEvent, participants: ['A', 'B', 'C'] };
    const memberMap = new Map([['A', { skill: 5 }]]);

    expect(findUnratedParticipants(event, memberMap, ['C'])).toEqual(['B']);
  });

  it('全員レート設定済みなら空配列', () => {
    const event = { ...baseEvent, participants: ['A'] };
    expect(findUnratedParticipants(event, new Map([['A', { skill: 1 }]]), [])).toEqual([]);
  });
});

// GAS が clasp push 前（旧キー ordering のみ）/ push 後（新キー skill）のどちらを
// 返しても rating が正しく設定されることを検証する後方互換テスト。
// 参照: docs/plans/2026-07-29-rating-vocabulary.md
describe('readTmpSheet（新旧フィールド名の後方互換）', () => {
  const originalUrl = process.env.GAS_WEB_APP_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalUrl === undefined) {
      delete process.env.GAS_WEB_APP_URL;
    } else {
      process.env.GAS_WEB_APP_URL = originalUrl;
    }
  });

  it('GASが旧キー ordering のみを返す場合でもskillが正しく読める（push前）', async () => {
    process.env.GAS_WEB_APP_URL = 'https://gas.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'ok',
            participants: [
              { eventId: '1', name: '田中太郎', gender: 'M', ordering: 37.68 },
            ],
          }),
      }),
    );

    const memberMap = await readTmpSheet('tmp_0409');
    expect(memberMap.get('田中太郎')).toEqual({ skill: 37.68, gender: 'M' });
  });

  it('GASが新キー skill のみを返す場合も正しく読める（push後）', async () => {
    process.env.GAS_WEB_APP_URL = 'https://gas.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'ok',
            participants: [
              { eventId: '1', name: '田中太郎', gender: 'M', skill: 37.68, ordering: null },
            ],
          }),
      }),
    );

    const memberMap = await readTmpSheet('tmp_0409');
    expect(memberMap.get('田中太郎')).toEqual({ skill: 37.68, gender: 'M' });
  });

  it('GASが新旧両方のキーを返す場合はskill（新名称）を優先する', () => {
    process.env.GAS_WEB_APP_URL = 'https://gas.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'ok',
            participants: [
              // 新旧で値が食い違っていても新名称(skill)を信頼する
              { eventId: '1', name: '田中太郎', gender: 'M', skill: 37.68, ordering: 999 },
            ],
          }),
      }),
    );

    return readTmpSheet('tmp_0409').then((memberMap) => {
      expect(memberMap.get('田中太郎')?.skill).toBe(37.68);
    });
  });

  it('skill/ordering どちらも無い場合はskillがundefinedになる（issue検出対象）', async () => {
    process.env.GAS_WEB_APP_URL = 'https://gas.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: 'ok',
            participants: [
              { eventId: '1', name: '未登録さん', gender: '', ordering: null },
            ],
          }),
      }),
    );

    const memberMap = await readTmpSheet('tmp_0409');
    expect(memberMap.get('未登録さん')?.skill).toBeUndefined();
    expect(checkPlayerIssues(['未登録さん'], memberMap)).toEqual([
      { name: '未登録さん', reason: 'レーティング未設定' },
    ]);
  });
});

// E-ToMo (system.hawai-an.com) は数分だけ接続不能になることがあり、単発の fetch
// だと undici の接続タイムアウト（既定10秒）で定期実行がまるごと落ちていた。
// 参照: docs/plans/2026-08-11-auto-session-retry.md
describe('fetchWithRetry', () => {
  // テストではバックオフを待たない
  const NO_WAIT = [0, 0];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = () => ({ ok: true, status: 200 });

  it('接続タイムアウト後の再試行で成功すればレスポンスを返す', async () => {
    const connectTimeout = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('Connect Timeout Error'),
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectTimeout)
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry('https://example.test', {}, 'test', NO_WAIT);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('全試行が失敗したら原因付きで throw する', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: new Error('Connect Timeout Error'),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry('https://example.test', {}, 'E-ToMo', NO_WAIT),
    ).rejects.toThrow(/E-ToMo: 3回試行して失敗しました.*Connect Timeout Error/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('5xx は再試行する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry('https://example.test', {}, 'test', NO_WAIT);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4xx は再試行せずそのまま返す（呼び出し側が判断する）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry('https://example.test', {}, 'test', NO_WAIT);

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('呼び出し側の init（method/body）を保ったままリトライする', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithRetry(
      'https://example.test',
      { method: 'POST', body: '{"a":1}' },
      'test',
      NO_WAIT,
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.test',
      expect.objectContaining({ method: 'POST', body: '{"a":1}' }),
    );
  });
});

describe('describeError', () => {
  it('undici の cause を含めて1行にまとめる', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('Connect Timeout Error (attempted address: system.hawai-an.com:443)'),
    });
    expect(describeError(error)).toBe(
      'fetch failed: Connect Timeout Error (attempted address: system.hawai-an.com:443)',
    );
  });
});

// 詳細取得の失敗を「参加者0名」として扱うと、新規なら空セッションを作成し、
// 既存セッションがあればロースター同期で全員を削除してしまう。
describe('fetchEventDetails（詳細取得の失敗を参加者0名と混同しない）', () => {
  const NO_WAIT_ENV = 'https://etomo.test/event_info.php?token=x';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const detailHtml = (name: string) =>
    [
      '場所：千川館体育館',
      '人数：1/12',
      '出席予定メンバー',
      '<div>header</div>',
      `<div><font color="#000080"><b>${name}</b></font></div>`,
    ].join('\n');

  /** E-ToMo は Shift_JIS を返すので arrayBuffer で応答する */
  const sjisResponse = (html: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const buf = iconv.encode(html, 'Shift_JIS');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  });

  const event = (eventId: string, title: string) => ({
    eventId,
    title,
    dateMonth: 4,
    dateDay: 9,
    startTime: '18:30',
    endTime: '21:30',
    venue: '千川館',
    note: '複',
    participantCount: 1,
    capacity: 20,
    waitlistCount: 0,
  });

  it('取得できたイベントだけ details に入り、失敗したイベントは failed に分離される', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('event_id=OK')) return Promise.resolve(sjisResponse(detailHtml('田中太郎')));
      return Promise.reject(new TypeError('fetch failed'));
    });
    vi.stubGlobal('fetch', fetchMock);

    // リトライのバックオフ（最大76秒）とイベント間 sleep を実時間で待たない
    vi.useFakeTimers();
    try {
      const pending = fetchEventDetails(
        [event('OK', '4/9(水)18:30〜21:30@千川館.複'), event('NG', '4/9(水)9:00〜12:00@高松.複')],
        NO_WAIT_ENV,
      );
      await vi.runAllTimersAsync();
      const { details, failed } = await pending;

      expect(details).toHaveLength(1);
      expect(details[0].eventId).toBe('OK');
      expect(details[0].participants).toEqual(['田中太郎']);

      // 失敗したイベントは participants: [] のダミーではなく failed に入る
      expect(failed.map((e) => e.eventId)).toEqual(['NG']);
      expect(details.some((d) => d.eventId === 'NG')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
