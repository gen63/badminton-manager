import { describe, it, expect } from 'vitest';
import type { Match } from '../types/match';
import { EMPTY_COURT_STATE, type Court } from '../types/court';
import {
  ARCHIVE_THRESHOLD_MS,
  VISIBLE_AFTER_LAST_MATCH_MS,
  VISIBLE_BEFORE_START_MS,
  computeFirstMatchStartedAt,
  computeHasActiveCourt,
  computeLastMatchFinishedAt,
  isSessionVisible,
} from './sessionArchive';

function makeMatch(startedAt: number, id = `m-${startedAt}`): Match {
  return {
    id,
    courtId: 1,
    teamA: ['A1', 'A2'],
    teamB: ['B1', 'B2'],
    scoreA: 0,
    scoreB: 0,
    startedAt,
    finishedAt: startedAt + 1000,
  };
}

/** `now` を基準に offsetDays 日ずれたローカル日付のタイムスタンプ(ms)を返す */
function makeStartTime(now: number, offsetDays: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

describe('computeFirstMatchStartedAt', () => {
  it('空配列はnullを返す', () => {
    expect(computeFirstMatchStartedAt([])).toBeNull();
  });

  it('試合1件ならその開始時刻を返す', () => {
    expect(computeFirstMatchStartedAt([makeMatch(1000)])).toBe(1000);
  });

  it('複数試合の最小値を返す（順不同）', () => {
    const matches = [makeMatch(3000), makeMatch(1000), makeMatch(2000)];
    expect(computeFirstMatchStartedAt(matches)).toBe(1000);
  });
});

function makeCourt(id: number, overrides: Partial<Court> = {}): Court {
  return { id, ...EMPTY_COURT_STATE, ...overrides };
}

describe('computeLastMatchFinishedAt', () => {
  it('空配列はnullを返す', () => {
    expect(computeLastMatchFinishedAt([])).toBeNull();
  });

  it('finishedAt を持つ試合が無ければ null', () => {
    const matches = [{ ...makeMatch(1000), finishedAt: 0 }];
    expect(computeLastMatchFinishedAt(matches)).toBeNull();
  });

  it('複数試合の最大値を返す（順不同）', () => {
    const matches = [makeMatch(3000), makeMatch(1000), makeMatch(2000)];
    expect(computeLastMatchFinishedAt(matches)).toBe(4000);
  });

  it('finishedAt=0 の試合は無視して最大値を取る', () => {
    const matches = [makeMatch(1000), { ...makeMatch(9000), finishedAt: 0 }];
    expect(computeLastMatchFinishedAt(matches)).toBe(2000);
  });
});

describe('computeHasActiveCourt', () => {
  it('コートが無ければ false', () => {
    expect(computeHasActiveCourt([])).toBe(false);
  });

  it('全コートが空なら false', () => {
    expect(computeHasActiveCourt([makeCourt(1), makeCourt(2)])).toBe(false);
  });

  it('試合中のコートがあれば true', () => {
    expect(computeHasActiveCourt([makeCourt(1), makeCourt(2, { isPlaying: true })])).toBe(true);
  });

  it('配置済み・未開始のコートも true（3分で自動開始されるため）', () => {
    const assigned = makeCourt(1, { teamA: ['p1', 'p2'], assignedAt: 1000 });
    expect(computeHasActiveCourt([assigned])).toBe(true);
  });
});

describe('isSessionVisible', () => {
  const now = 1_700_000_000_000;

  describe('firstMatchStartedAt ありの場合（12h 絶対上限）', () => {
    it('11時間59分前なら表示', () => {
      const t = now - (11 * 60 + 59) * 60 * 1000;
      expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(true);
    });

    it('ちょうど12時間前なら非表示（厳密な>）', () => {
      const t = now - ARCHIVE_THRESHOLD_MS;
      expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(false);
    });

    it('12時間1秒前なら非表示', () => {
      const t = now - ARCHIVE_THRESHOLD_MS - 1000;
      expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(false);
    });

    it('未来時刻（時計ずれ）なら表示', () => {
      const t = now + 60_000;
      expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(true);
    });

    it('firstMatchStartedAt が有効なら古い practiceStartTime より優先', () => {
      const t = now - 60_000;
      expect(
        isSessionVisible(
          {
            firstMatchStartedAt: t,
            config: { practiceStartTime: makeStartTime(now, -100) },
          },
          now,
        ),
      ).toBe(true);
    });

    it('lastMatchFinishedAt 未設定（旧データ）は従来どおり12h判定にフォールバック', () => {
      const t = now - 6 * 60 * 60 * 1000;
      expect(isSessionVisible({ firstMatchStartedAt: t }, now)).toBe(true);
    });
  });

  describe('最終試合から30分ルール（試合開始済み）', () => {
    const firstMatchStartedAt = now - 3 * 60 * 60 * 1000;

    it('29分前に終わっていれば表示', () => {
      const lastMatchFinishedAt = now - VISIBLE_AFTER_LAST_MATCH_MS + 60_000;
      expect(isSessionVisible({ firstMatchStartedAt, lastMatchFinishedAt }, now)).toBe(true);
    });

    it('ちょうど30分前なら非表示（厳密な>）', () => {
      const lastMatchFinishedAt = now - VISIBLE_AFTER_LAST_MATCH_MS;
      expect(isSessionVisible({ firstMatchStartedAt, lastMatchFinishedAt }, now)).toBe(false);
    });

    it('31分前なら非表示', () => {
      const lastMatchFinishedAt = now - VISIBLE_AFTER_LAST_MATCH_MS - 60_000;
      expect(isSessionVisible({ firstMatchStartedAt, lastMatchFinishedAt }, now)).toBe(false);
    });

    it('12時間より手前でも30分を過ぎていれば非表示（旧12h判定からの変化点）', () => {
      const lastMatchFinishedAt = now - 2 * 60 * 60 * 1000;
      expect(isSessionVisible({ firstMatchStartedAt, lastMatchFinishedAt }, now)).toBe(false);
    });
  });

  describe('進行中コートのガード', () => {
    it('最終試合が3時間前でもコートが進行中なら表示', () => {
      expect(
        isSessionVisible(
          {
            firstMatchStartedAt: now - 4 * 60 * 60 * 1000,
            lastMatchFinishedAt: now - 3 * 60 * 60 * 1000,
            hasActiveCourt: true,
          },
          now,
        ),
      ).toBe(true);
    });

    it('コートが進行中でも12時間の絶対上限を超えたら非表示', () => {
      expect(
        isSessionVisible(
          {
            firstMatchStartedAt: now - ARCHIVE_THRESHOLD_MS - 1000,
            lastMatchFinishedAt: now - 1000,
            hasActiveCourt: true,
          },
          now,
        ),
      ).toBe(false);
    });

    it('コートが空なら30分ルールどおり非表示', () => {
      expect(
        isSessionVisible(
          {
            firstMatchStartedAt: now - 4 * 60 * 60 * 1000,
            lastMatchFinishedAt: now - 3 * 60 * 60 * 1000,
            hasActiveCourt: false,
          },
          now,
        ),
      ).toBe(false);
    });
  });

  describe('firstMatchStartedAt なしの場合（practiceStartTime フォールバック）', () => {
    it('config 自体が未定義なら非表示', () => {
      expect(isSessionVisible({}, now)).toBe(false);
    });

    it('firstMatchStartedAt=null + config 未定義なら非表示', () => {
      expect(isSessionVisible({ firstMatchStartedAt: null }, now)).toBe(false);
    });

    it('practiceStartTime 未定義なら非表示', () => {
      expect(isSessionVisible({ config: {} }, now)).toBe(false);
    });

    it('practiceStartTime が今(=now)なら表示', () => {
      expect(
        isSessionVisible({ config: { practiceStartTime: makeStartTime(now, 0) } }, now),
      ).toBe(true);
    });

    it('practiceStartTime が明日なら非表示（90分以上先のため）', () => {
      expect(
        isSessionVisible({ config: { practiceStartTime: makeStartTime(now, 1) } }, now),
      ).toBe(false);
    });

    it('practiceStartTime が昨日なら非表示', () => {
      expect(
        isSessionVisible({ config: { practiceStartTime: makeStartTime(now, -1) } }, now),
      ).toBe(false);
    });

    it('practiceStartTime が1ヶ月前なら非表示', () => {
      expect(
        isSessionVisible({ config: { practiceStartTime: makeStartTime(now, -30) } }, now),
      ).toBe(false);
    });
  });

  describe('開始90分前ルール（試合未開始）', () => {
    it('ちょうど90分前は表示', () => {
      const startTime = now + VISIBLE_BEFORE_START_MS;
      expect(isSessionVisible({ config: { practiceStartTime: startTime } }, now)).toBe(true);
    });

    it('90分1秒前は非表示', () => {
      const startTime = now + VISIBLE_BEFORE_START_MS + 1000;
      expect(isSessionVisible({ config: { practiceStartTime: startTime } }, now)).toBe(false);
    });

    it('89分59秒前は表示', () => {
      const startTime = now + VISIBLE_BEFORE_START_MS - 1000;
      expect(isSessionVisible({ config: { practiceStartTime: startTime } }, now)).toBe(true);
    });

    it('開始時刻ちょうどは表示', () => {
      expect(isSessionVisible({ config: { practiceStartTime: now } }, now)).toBe(true);
    });

    it('開始から1時間後（同日）は表示', () => {
      const startTime = now - 60 * 60 * 1000;
      expect(isSessionVisible({ config: { practiceStartTime: startTime } }, now)).toBe(true);
    });
  });
});
