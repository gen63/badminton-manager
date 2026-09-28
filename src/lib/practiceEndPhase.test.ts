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
  resolvePracticeEndTime,
  getPracticeEndPhaseTimerDelay,
  PRACTICE_END_TIMER_MAX_DELAY_MS,
  isPastEndOverrideActive,
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

describe('resolvePracticeEndTime', () => {
  const start = new Date(2026, 8, 26, 18, 30).getTime();

  it('設定値があればそれを使う', () => {
    const end = new Date(2026, 8, 26, 21, 0).getTime();
    expect(resolvePracticeEndTime({ practiceStartTime: start, practiceEndTime: end })).toBe(end);
  });

  it('未設定・0（空欄）は開始の3時間後', () => {
    const expected = new Date(2026, 8, 26, 21, 30).getTime();
    expect(resolvePracticeEndTime({ practiceStartTime: start })).toBe(expected);
    expect(resolvePracticeEndTime({ practiceStartTime: start, practiceEndTime: 0 })).toBe(expected);
  });

  it('開始日時も無ければ undefined', () => {
    expect(resolvePracticeEndTime(undefined)).toBeUndefined();
    expect(resolvePracticeEndTime({})).toBeUndefined();
  });
});

describe('getPracticeEndPhaseTimerDelay', () => {
  const end = new Date(2026, 8, 26, 21, 30).getTime();

  it('次の切り替え時刻の少し後まで待つ', () => {
    expect(getPracticeEndPhaseTimerDelay(end, end - 25 * MIN)).toBe(5 * MIN + 50);
  });

  it('終了時刻が遠い未来でも上限（setTimeout の 2^31-1 ms を超えない）で区切る', () => {
    const farEnd = end + 60 * 24 * 60 * MIN; // 60日後
    const delay = getPracticeEndPhaseTimerDelay(farEnd, end);
    expect(delay).toBe(PRACTICE_END_TIMER_MAX_DELAY_MS);
    expect(delay!).toBeLessThan(2 ** 31 - 1);
  });

  it('これ以上切り替わらないなら null', () => {
    expect(getPracticeEndPhaseTimerDelay(end, end)).toBeNull();
    expect(getPracticeEndPhaseTimerDelay(undefined, end)).toBeNull();
  });
});

describe('isPastEndOverrideActive', () => {
  const end = new Date(2026, 8, 26, 21, 30).getTime();

  it('延長した時点の終了時刻と今の終了時刻が一致する間だけ有効', () => {
    expect(isPastEndOverrideActive(end, end)).toBe(true);
  });

  it('終了時刻が変わったら無効（新しい終了時刻では通常どおり止まる）', () => {
    expect(isPastEndOverrideActive(end, end + 30 * MIN)).toBe(false);
  });

  it('延長なし（0・未設定）は無効', () => {
    expect(isPastEndOverrideActive(0, end)).toBe(false);
    expect(isPastEndOverrideActive(undefined, end)).toBe(false);
  });
});
