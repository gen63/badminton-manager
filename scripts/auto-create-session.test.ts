import { describe, it, expect } from 'vitest';
import {
  parseEventTitle,
  parseEventList,
  parseEventDetail,
  filterEventsByDate,
  findNextPracticeDate,
  checkPlayerIssues,
  decodeHtmlEntities,
  formatEventSummary,
  buildSessionData,
  formatPracticeDate,
  buildPracticeStartTime,
  buildTmpSheetName,
} from './auto-create-session';

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
    ['田中太郎', { ordering: 1, gender: 'M' as const }],
    ['佐藤花子', { ordering: 2, gender: 'F' as const }],
    ['山田次郎', { ordering: undefined, gender: 'M' as const }],
  ]);

  it('全員序列があれば空配列', () => {
    expect(checkPlayerIssues(['田中太郎', '佐藤花子'], memberMap)).toEqual([]);
  });

  it('tmpシートに未登録の参加者を検出', () => {
    const issues = checkPlayerIssues(['未登録さん'], memberMap);
    expect(issues).toEqual([{ name: '未登録さん', reason: '序列未設定' }]);
  });

  it('序列未設定を検出', () => {
    const issues = checkPlayerIssues(['山田次郎'], memberMap);
    expect(issues).toEqual([{ name: '山田次郎', reason: '序列未設定' }]);
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
  it('セッションデータを正しく構築する（序列→rating変換）', () => {
    const event = {
      eventId: '123', title: 'test', dateMonth: 4, dateDay: 9,
      startTime: '18:30', endTime: '21:30', venue: '千川館', note: '複',
      participantCount: 0, capacity: null, waitlistCount: 0,
      location: '', participants: ['田中太郎', '佐藤花子'],
      genders: { '田中太郎': 'M' as const, '佐藤花子': 'F' as const },
    };
    const memberMap = new Map([
      ['田中太郎', { ordering: 1, gender: 'M' as const }],
      ['佐藤花子', { ordering: 3, gender: 'F' as const }],
    ]);
    const date = new Date(2026, 3, 9);

    const data = buildSessionData(event, memberMap, date);
    expect(data.config.gym).toBe('千川館');
    expect(data.config.gameMode).toBe('doubles');
    expect(formatPracticeDate(new Date(data.config.practiceStartTime))).toBe('2026-04-09');
    expect(data.etomoEventId).toBe('123');
    expect(data.gameState.players).toHaveLength(2);
    expect(data.gameState.players[0].name).toBe('田中太郎');
    expect(data.gameState.players[0].rating).toBe(999); // 1000 - 1
    expect(data.gameState.players[0].gender).toBe('M');
    expect(data.gameState.players[1].rating).toBe(997); // 1000 - 3
    expect(data.gameState.players[0].isResting).toBe(true);
    expect(data.gameState.settings.practiceType).toBe('複');
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

  it('序列未設定の参加者はrating無し、性別はE-tomoから取得', () => {
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
});

describe('buildTmpSheetName', () => {
  it('tmp_MMDD形式でシート名を生成', () => {
    expect(buildTmpSheetName(new Date(2026, 3, 9))).toBe('tmp_0409');
    expect(buildTmpSheetName(new Date(2026, 0, 1))).toBe('tmp_0101');
    expect(buildTmpSheetName(new Date(2026, 11, 31))).toBe('tmp_1231');
  });
});
