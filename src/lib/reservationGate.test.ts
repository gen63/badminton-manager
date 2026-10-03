import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import {
  computeExpectedDiffById,
  getReservationPickState,
  hasOverExpectedMember,
  isOverExpectedDiff,
  isReservationHeldByExpectedDiff,
  overExpectedMemberIds,
  RESERVATION_EXPECTED_DIFF_LIMIT,
} from './reservationGate';

const NOW = 1_000_000_000_000;
const MIN = 60 * 1000;

function makePlayer(id: string, gamesPlayed: number, stayMin?: number): Player {
  return {
    id,
    name: id,
    rating: 1500,
    gamesPlayed,
    isResting: false,
    lastPlayedAt: 0,
    activatedAt: NOW - 60 * MIN,
    ...(stayMin !== undefined
      ? { operationStatus: { payment: true, roster: true, checkin: true }, opsCompletedAt: NOW - stayMin * MIN }
      : {}),
  };
}

describe('isOverExpectedDiff', () => {
  it('小数1桁に丸めた値が閾値以上で該当（ちょうどを含む）', () => {
    expect(isOverExpectedDiff(1.5, 1.5)).toBe(true);
    expect(isOverExpectedDiff(1.46, 1.5)).toBe(true); // 1.5 に丸まる
    expect(isOverExpectedDiff(1.44, 1.5)).toBe(false);
    expect(isOverExpectedDiff(-3, 1.5)).toBe(false);
  });
  it('null / undefined は対象外', () => {
    expect(isOverExpectedDiff(null, 1.5)).toBe(false);
    expect(isOverExpectedDiff(undefined, 1.5)).toBe(false);
  });
});

describe('hasOverExpectedMember', () => {
  it('メンバーの誰かが該当なら true。マップに無い人は対象外', () => {
    const m = new Map<string, number | null>([['a', 0], ['b', 2], ['c', null]]);
    expect(hasOverExpectedMember(['a', 'b'], m, 1.5)).toBe(true);
    expect(hasOverExpectedMember(['a', 'c', 'zzz'], m, 1.5)).toBe(false);
  });
});

describe('computeExpectedDiffById', () => {
  it('回数平均モード: 差 = 試合数 − 全員平均', () => {
    const players = [makePlayer('a', 4), makePlayer('b', 0), makePlayer('c', 0), makePlayer('d', 0)];
    const m = computeExpectedDiffById({ players, useStayDuration: false, practiceStartTime: NOW - 60 * MIN, now: NOW });
    expect(m.get('a')).toBeCloseTo(3);
    expect(m.get('b')).toBeCloseTo(-1);
  });

  it('滞在時間モード: 完了者だけ滞在按分、未完了は null', () => {
    const players = [
      makePlayer('a', 4, 30), // 滞在30分
      makePlayer('b', 0, 60),
      { ...makePlayer('c', 9), operationStatus: { payment: true, roster: false, checkin: true } },
    ];
    const m = computeExpectedDiffById({ players, useStayDuration: true, practiceStartTime: NOW - 60 * MIN, now: NOW });
    // 完了者の合計試合 4、滞在 30:60 → a の期待 4*30/90
    expect(m.get('a')).toBeCloseTo(4 - (4 * 30) / 90);
    expect(m.get('c')).toBeNull();
  });

  it('練習終了時刻で滞在が頭打ちになる', () => {
    const players = [makePlayer('a', 2, 60), makePlayer('b', 2, 60)];
    const m = computeExpectedDiffById({
      players, useStayDuration: true, practiceStartTime: NOW - 60 * MIN,
      practiceEndTime: NOW - 30 * MIN, now: NOW,
    });
    expect(m.get('a')).toBeCloseTo(0);
  });

  it('滞在合計が0（全員未完了）は全員 null', () => {
    const players = [makePlayer('a', 5), makePlayer('b', 0)];
    const m = computeExpectedDiffById({ players, useStayDuration: true, practiceStartTime: NOW - 60 * MIN, now: NOW });
    expect([...m.values()]).toEqual([null, null]);
  });
});

describe('getReservationPickState（予約追加 UI の作成者/非作成者の分岐）', () => {
  it('閾値未満・null は誰でも free', () => {
    expect(getReservationPickState(1.4, false)).toBe('free');
    expect(getReservationPickState(null, false)).toBe('free');
    expect(getReservationPickState(undefined, true)).toBe('free');
  });
  it('閾値ちょうど以上: 非作成者は blocked、作成者は warn', () => {
    expect(getReservationPickState(1.5, false)).toBe('blocked');
    expect(getReservationPickState(1.5, true)).toBe('warn');
    expect(getReservationPickState(4, false)).toBe('blocked');
  });
});

describe('isReservationHeldByExpectedDiff / overExpectedMemberIds（保留判定・一覧表示と配置で共用）', () => {
  const diffs = new Map<string, number | null>([['a', 1.8], ['b', 0], ['c', null]]);
  it('ボーダーは 1.5 固定', () => {
    expect(RESERVATION_EXPECTED_DIFF_LIMIT).toBe(1.5);
  });
  it('メンバーの誰かが 1.5 以上なら保留、該当者 ID を返す', () => {
    expect(isReservationHeldByExpectedDiff({ playerIds: ['a', 'b'] }, diffs)).toBe(true);
    expect(overExpectedMemberIds(['b', 'a', 'c'], diffs)).toEqual(['a']);
    expect(isReservationHeldByExpectedDiff({ playerIds: ['b', 'c'] }, diffs)).toBe(false);
  });
  it('forcePriority=true は保留しない（false / 未設定は従来どおり）', () => {
    expect(isReservationHeldByExpectedDiff({ playerIds: ['a'], forcePriority: true }, diffs)).toBe(false);
    expect(isReservationHeldByExpectedDiff({ playerIds: ['a'], forcePriority: false }, diffs)).toBe(true);
  });
});
