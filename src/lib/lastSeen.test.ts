import { describe, it, expect } from 'vitest';
import { formatLastSeen } from './lastSeen';

const NOW = 1_700_000_000_000;

describe('formatLastSeen', () => {
  it('lastSeenAt が undefined なら未閲覧', () => {
    expect(formatLastSeen(undefined, NOW)).toEqual({ label: '未閲覧', tone: 'never' });
  });

  it('lastSeenAt が数値でない (NaN) なら未閲覧', () => {
    expect(formatLastSeen(Number.NaN, NOW)).toEqual({ label: '未閲覧', tone: 'never' });
  });

  it('未来時刻（クライアント時計ずれ）は閲覧中扱い', () => {
    expect(formatLastSeen(NOW + 5_000, NOW)).toEqual({ label: '閲覧中', tone: 'live' });
  });

  it('90秒以内は閲覧中', () => {
    expect(formatLastSeen(NOW - 90_000, NOW)).toEqual({ label: '閲覧中', tone: 'live' });
  });

  it('90秒を1msでも超えると分表示 (直近) に切り替わる', () => {
    expect(formatLastSeen(NOW - 90_001, NOW)).toEqual({ label: '1分前', tone: 'recent' });
  });

  it('14分前は直近扱い', () => {
    expect(formatLastSeen(NOW - 14 * 60_000, NOW)).toEqual({ label: '14分前', tone: 'recent' });
  });

  it('15分未満の境界: 899999ms は直近扱い', () => {
    expect(formatLastSeen(NOW - 899_999, NOW)).toEqual({ label: '14分前', tone: 'recent' });
  });

  it('15分ちょうどで放置 (stale) 扱いに切り替わる', () => {
    expect(formatLastSeen(NOW - 15 * 60_000, NOW)).toEqual({ label: '15分前', tone: 'stale' });
  });

  it('59分前は放置扱いで分表示', () => {
    expect(formatLastSeen(NOW - 59 * 60_000, NOW)).toEqual({ label: '59分前', tone: 'stale' });
  });

  it('60分を超えても分表記のまま', () => {
    expect(formatLastSeen(NOW - 90 * 60_000, NOW)).toEqual({ label: '90分前', tone: 'stale' });
  });
});
