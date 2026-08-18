import { describe, it, expect } from 'vitest';
import {
  COURT_EMPHASIS_BLINK_MS,
  COURT_EMPHASIS_THICK_MS,
  getCourtEmphasisLevel,
  getNextCourtEmphasisDelay,
} from './courtEmphasis';

const NOW = 1_700_000_000_000;

describe('getCourtEmphasisLevel', () => {
  it('未開始（startedAt=0）は none', () => {
    expect(getCourtEmphasisLevel(0, NOW)).toBe('none');
  });

  it('4分30秒未満は none', () => {
    expect(getCourtEmphasisLevel(NOW - (COURT_EMPHASIS_THICK_MS - 1), NOW)).toBe('none');
  });

  it('4分30秒ちょうどで thick', () => {
    expect(getCourtEmphasisLevel(NOW - COURT_EMPHASIS_THICK_MS, NOW)).toBe('thick');
  });

  it('6分未満は thick のまま', () => {
    expect(getCourtEmphasisLevel(NOW - (COURT_EMPHASIS_BLINK_MS - 1), NOW)).toBe('thick');
  });

  it('6分ちょうどで blink', () => {
    expect(getCourtEmphasisLevel(NOW - COURT_EMPHASIS_BLINK_MS, NOW)).toBe('blink');
  });

  it('6分を大きく超えても blink', () => {
    expect(getCourtEmphasisLevel(NOW - 30 * 60 * 1000, NOW)).toBe('blink');
  });

  it('startedAt が未来（端末時刻ずれ）でも none', () => {
    expect(getCourtEmphasisLevel(NOW + 60 * 1000, NOW)).toBe('none');
  });
});

describe('getNextCourtEmphasisDelay', () => {
  it('未開始は null', () => {
    expect(getNextCourtEmphasisDelay(0, NOW)).toBeNull();
  });

  it('none の間は thick までの残り', () => {
    const startedAt = NOW - 60 * 1000;
    expect(getNextCourtEmphasisDelay(startedAt, NOW)).toBe(COURT_EMPHASIS_THICK_MS - 60 * 1000);
  });

  it('thick の間は blink までの残り', () => {
    const startedAt = NOW - COURT_EMPHASIS_THICK_MS;
    expect(getNextCourtEmphasisDelay(startedAt, NOW)).toBe(
      COURT_EMPHASIS_BLINK_MS - COURT_EMPHASIS_THICK_MS
    );
  });

  it('blink 到達後は null（以降タイマー不要）', () => {
    expect(getNextCourtEmphasisDelay(NOW - COURT_EMPHASIS_BLINK_MS, NOW)).toBeNull();
  });
});
