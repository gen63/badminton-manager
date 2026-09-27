import { describe, it, expect } from 'vitest';
import {
  getPracticeEndPhase,
  getNextPracticeEndPhaseChangeAt,
  buildPracticeEndTime,
  formatHHMM,
  shouldAnnouncePracticeEndPhase,
  buildPracticeEndAnnouncement,
  PRACTICE_END_ANNOUNCE_MAX_LATE_MS,
  PRACTICE_LAST_CALL_MS,
  PRACTICE_CLOSED_MS,
} from './practiceEndPhase';

const MIN = 60 * 1000;

describe('getPracticeEndPhase', () => {
  const end = new Date(2026, 8, 26, 21, 30).getTime();

  it('終了時刻が未設定なら常に normal', () => {
    expect(getPracticeEndPhase(undefined, end)).toBe('normal');
    expect(getPracticeEndPhase(null, end)).toBe('normal');
    expect(getPracticeEndPhase(0, end)).toBe('normal');
  });

  it('20分前より前は normal', () => {
    expect(getPracticeEndPhase(end, end - 21 * MIN)).toBe('normal');
    expect(getPracticeEndPhase(end, end - PRACTICE_LAST_CALL_MS - 1)).toBe('normal');
  });

  it('20分前ちょうど〜15分前の手前は lastCall', () => {
    expect(getPracticeEndPhase(end, end - PRACTICE_LAST_CALL_MS)).toBe('lastCall');
    expect(getPracticeEndPhase(end, end - 16 * MIN)).toBe('lastCall');
  });

  it('15分前以降（終了時刻を過ぎても）は closed', () => {
    expect(getPracticeEndPhase(end, end - PRACTICE_CLOSED_MS)).toBe('closed');
    expect(getPracticeEndPhase(end, end)).toBe('closed');
    expect(getPracticeEndPhase(end, end + 60 * MIN)).toBe('closed');
  });
});

describe('getNextPracticeEndPhaseChangeAt', () => {
  const end = new Date(2026, 8, 26, 21, 30).getTime();

  it('normal 中は 20分前の時刻', () => {
    expect(getNextPracticeEndPhaseChangeAt(end, end - 60 * MIN)).toBe(end - PRACTICE_LAST_CALL_MS);
  });

  it('lastCall 中は 15分前の時刻', () => {
    expect(getNextPracticeEndPhaseChangeAt(end, end - 18 * MIN)).toBe(end - PRACTICE_CLOSED_MS);
  });

  it('closed 以降・未設定は null', () => {
    expect(getNextPracticeEndPhaseChangeAt(end, end - 10 * MIN)).toBeNull();
    expect(getNextPracticeEndPhaseChangeAt(undefined, end)).toBeNull();
  });
});

describe('buildPracticeEndTime', () => {
  const start = new Date(2026, 8, 26, 18, 30).getTime();

  it('開始日の HH:MM を返す', () => {
    expect(buildPracticeEndTime(start, '21:30')).toBe(new Date(2026, 8, 26, 21, 30).getTime());
  });

  it('開始以前になる時刻は翌日扱い', () => {
    expect(buildPracticeEndTime(start, '00:30')).toBe(new Date(2026, 8, 27, 0, 30).getTime());
  });

  it('形式不正は null', () => {
    expect(buildPracticeEndTime(start, '')).toBeNull();
    expect(buildPracticeEndTime(start, '25:00')).toBeNull();
    expect(buildPracticeEndTime(start, 'abc')).toBeNull();
  });
});

describe('formatHHMM', () => {
  it('ゼロ埋めした HH:MM', () => {
    expect(formatHHMM(new Date(2026, 8, 26, 9, 5).getTime())).toBe('09:05');
  });
});

describe('shouldAnnouncePracticeEndPhase', () => {
  const end = new Date(2026, 8, 26, 21, 30).getTime();
  const lastCallAt = end - PRACTICE_LAST_CALL_MS;
  const closedAt = end - PRACTICE_CLOSED_MS;

  it('normal → lastCall を切り替え直後に読み上げる', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: 'normal', next: 'lastCall', practiceEndTime: end, now: lastCallAt + 100 })).toBe(true);
  });

  it('lastCall → closed を切り替え直後に読み上げる', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: 'lastCall', next: 'closed', practiceEndTime: end, now: closedAt + 100 })).toBe(true);
  });

  it('初回表示（prev なし）は鳴らさない', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: null, next: 'lastCall', practiceEndTime: end, now: lastCallAt + 100 })).toBe(false);
  });

  it('切り替えから60秒を超えて遅れていたら鳴らさない（バックグラウンド復帰）', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: 'normal', next: 'lastCall', practiceEndTime: end, now: lastCallAt + PRACTICE_END_ANNOUNCE_MAX_LATE_MS + 1 })).toBe(false);
  });

  it('段階が戻った・変わらないときは鳴らさない', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: 'closed', next: 'lastCall', practiceEndTime: end, now: lastCallAt + 100 })).toBe(false);
    expect(shouldAnnouncePracticeEndPhase({ prev: 'lastCall', next: 'lastCall', practiceEndTime: end, now: lastCallAt + 100 })).toBe(false);
  });

  it('終了時刻が未設定なら鳴らさない', () => {
    expect(shouldAnnouncePracticeEndPhase({ prev: 'normal', next: 'lastCall', practiceEndTime: 0, now: lastCallAt })).toBe(false);
  });
});

describe('buildPracticeEndAnnouncement', () => {
  it('段階ごとの文言', () => {
    expect(buildPracticeEndAnnouncement('lastCall')).toBe('練習終了20分前です。現在入ってる試合でラストです。');
    expect(buildPracticeEndAnnouncement('closed')).toBe('片付けの時間です、お願いします');
  });
});
