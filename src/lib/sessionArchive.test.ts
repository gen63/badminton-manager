import { describe, it, expect } from 'vitest';
import type { Match } from '../types/match';
import {
  ARCHIVE_THRESHOLD_MS,
  computeFirstMatchStartedAt,
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

/** `now` を基準に offsetDays 日ずれたローカル日付の YYYY-MM-DD を返す */
function makeDateStr(now: number, offsetDays: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

describe('isSessionVisible', () => {
  const now = 1_700_000_000_000;

  describe('firstMatchStartedAt ありの場合（12h判定）', () => {
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

    it('firstMatchStartedAt が有効なら古い practiceDate より優先', () => {
      const t = now - 60_000;
      expect(
        isSessionVisible(
          {
            firstMatchStartedAt: t,
            config: { practiceDate: makeDateStr(now, -100) },
          },
          now,
        ),
      ).toBe(true);
    });
  });

  describe('firstMatchStartedAt なしの場合（practiceDate フォールバック）', () => {
    it('config 自体が未定義なら非表示', () => {
      expect(isSessionVisible({}, now)).toBe(false);
    });

    it('firstMatchStartedAt=null + config 未定義なら非表示', () => {
      expect(isSessionVisible({ firstMatchStartedAt: null }, now)).toBe(false);
    });

    it('practiceDate 未定義なら非表示', () => {
      expect(isSessionVisible({ config: {} }, now)).toBe(false);
    });

    it('practiceDate が今日なら表示', () => {
      expect(
        isSessionVisible({ config: { practiceDate: makeDateStr(now, 0) } }, now),
      ).toBe(true);
    });

    it('practiceDate が明日なら表示', () => {
      expect(
        isSessionVisible({ config: { practiceDate: makeDateStr(now, 1) } }, now),
      ).toBe(true);
    });

    it('practiceDate が昨日なら非表示', () => {
      expect(
        isSessionVisible({ config: { practiceDate: makeDateStr(now, -1) } }, now),
      ).toBe(false);
    });

    it('practiceDate が1ヶ月前なら非表示', () => {
      expect(
        isSessionVisible({ config: { practiceDate: makeDateStr(now, -30) } }, now),
      ).toBe(false);
    });
  });
});
