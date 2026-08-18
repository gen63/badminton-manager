import { describe, it, expect } from 'vitest';
import {
  buildFinishOperationGuide,
  buildFinishOperationGuideHeadline,
  getNextFinishGuideDelay,
} from './finishOperationGuide';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import type { Court } from '../types/court';
import { EMPTY_COURT_STATE } from '../types/court';

const NOW = 1_700_000_000_000;

const emptyCourt = (id: number): Court => ({ id, ...EMPTY_COURT_STATE, restingPlayerIds: [] });

const playingCourt = (
  id: number,
  startedAt: number,
  teamA: [string, string] = ['p1', 'p2'],
  teamB: [string, string] = ['p3', 'p4'],
): Court => ({
  id,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  isPlaying: true,
  startedAt,
  finishedAt: 0,
  restingPlayerIds: [],
});

/** 経過 `elapsed` ms のコートになる開始時刻 */
const startedAtForElapsed = (elapsed: number) => NOW - elapsed;

describe('buildFinishOperationGuide', () => {
  const args = (over: Partial<Parameters<typeof buildFinishOperationGuide>[0]> = {}) => ({
    courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
    certainIds: new Set(['w1', 'w2']),
    now: NOW,
    showCourtNumber: true,
    ...over,
  });

  it('プレイ中コートが無ければ null', () => {
    expect(buildFinishOperationGuide(args({ courts: [emptyCourt(1), emptyCourt(2)] }))).toBeNull();
  });

  it('startedAt が 0 のコートはプレイ中とみなさない', () => {
    const notStarted = { ...playingCourt(1, 0), isPlaying: true };
    expect(buildFinishOperationGuide(args({ courts: [notStarted] }))).toBeNull();
  });

  it('4:30 の1ms手前は出さない（配置予測バーと重複するため）', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 1))] }),
    );
    expect(guide).toBeNull();
  });

  it('4:30 ちょうどで出る', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))] }),
    );
    expect(guide?.courtId).toBe(2);
    expect(guide?.playerIds).toEqual(['w1', 'w2']);
  });

  it('certainIds が空なら null', () => {
    expect(buildFinishOperationGuide(args({ certainIds: new Set() }))).toBeNull();
  });

  it('対象が全員コートに乗っていれば null', () => {
    // p1〜p4 は playingCourt のデフォルトメンバー
    expect(buildFinishOperationGuide(args({ certainIds: new Set(['p1', 'p3']) }))).toBeNull();
  });

  it('コートに乗っている人を除いた残りが担当になる', () => {
    const guide = buildFinishOperationGuide(args({ certainIds: new Set(['p1', 'w1']) }));
    expect(guide?.playerIds).toEqual(['w1']);
  });

  it('複数コートがプレイ中なら経過時間が最大のコートを指す', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS + 60_000)),
          playingCourt(3, startedAtForElapsed(10_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide?.courtId).toBe(2);
  });

  it('空きコートがあってもプレイ中コートを指す（callBasisCourtId との差分）', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [emptyCourt(1), playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
      }),
    );
    expect(guide?.courtId).toBe(2);
  });

  it('showCourtNumber が false なら courtId は null', () => {
    const guide = buildFinishOperationGuide(args({ showCourtNumber: false }));
    expect(guide).not.toBeNull();
    expect(guide?.courtId).toBeNull();
  });
});

describe('buildFinishOperationGuideHeadline', () => {
  it('コート番号は丸数字（コートカードの丸バッジと揃える）', () => {
    expect(buildFinishOperationGuideHeadline({ courtId: 1, playerIds: ['w1'] })).toBe(
      '①付近待機 操作担当',
    );
    expect(buildFinishOperationGuideHeadline({ courtId: 2, playerIds: ['w1'] })).toBe(
      '②付近待機 操作担当',
    );
    expect(buildFinishOperationGuideHeadline({ courtId: 3, playerIds: ['w1'] })).toBe(
      '③付近待機 操作担当',
    );
  });

  it('丸数字が無い範囲は素の数字＋コートに戻す', () => {
    expect(buildFinishOperationGuideHeadline({ courtId: 21, playerIds: ['w1'] })).toBe(
      '21コート付近待機 操作担当',
    );
  });

  it('コート番号が無ければ番号を省く（1面運用）', () => {
    expect(buildFinishOperationGuideHeadline({ courtId: null, playerIds: ['w1'] })).toBe(
      'コート付近待機 操作担当',
    );
  });
});

describe('getNextFinishGuideDelay', () => {
  it('プレイ中コートが無ければ null', () => {
    expect(getNextFinishGuideDelay([emptyCourt(1)], NOW)).toBeNull();
  });

  it('4:30 までの残り時間を返す', () => {
    const courts = [playingCourt(1, startedAtForElapsed(60_000))];
    expect(getNextFinishGuideDelay(courts, NOW)).toBe(MATCH_CALL_THRESHOLD_MS - 60_000);
  });

  it('既に 4:30 を超えていれば null', () => {
    const courts = [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))];
    expect(getNextFinishGuideDelay(courts, NOW)).toBeNull();
  });

  it('経過最大のコート基準で残りを返す', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(10_000)),
      playingCourt(2, startedAtForElapsed(120_000)),
    ];
    expect(getNextFinishGuideDelay(courts, NOW)).toBe(MATCH_CALL_THRESHOLD_MS - 120_000);
  });
});
