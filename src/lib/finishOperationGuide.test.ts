import { describe, it, expect } from 'vitest';
import {
  buildFinishOperationGuide,
  buildFinishOperationGuideHeadline,
  getNextFinishGuideDelay,
  canFinishGame,
  standbyCourtIds,
  STANDBY_CLOSE_START_MS,
  type FinishOperationGuide,
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

describe('standbyCourtIds', () => {
  it('プレイ中コートが無ければ空', () => {
    expect(standbyCourtIds([emptyCourt(1), emptyCourt(2)], NOW)).toEqual([]);
  });

  it('startedAt が 0 のコートは対象外', () => {
    expect(standbyCourtIds([{ ...playingCourt(1, 0), isPlaying: true }], NOW)).toEqual([]);
  });

  it('経過が離れていれば最も早く終わりそうな1面だけ', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(60_000)),
      playingCourt(2, startedAtForElapsed(200_000)),
      playingCourt(3, startedAtForElapsed(10_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([2]);
  });

  it('差が60秒ちょうどなら近接扱いで2面とも返す（id 昇順）', () => {
    const courts = [
      playingCourt(2, startedAtForElapsed(200_000 - STANDBY_CLOSE_START_MS)),
      playingCourt(1, startedAtForElapsed(200_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1, 2]);
  });

  it('差が60秒を1ms でも超えれば絞り込む', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(200_000)),
      playingCourt(2, startedAtForElapsed(200_000 - STANDBY_CLOSE_START_MS - 1)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1]);
  });

  it('近接コートが3面以上なら場所を絞れないので空（3面同時開始）', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      playingCourt(2, startedAtForElapsed(120_000)),
      playingCourt(3, startedAtForElapsed(120_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([]);
  });

  it('3面のうち2面だけ近接なら、その2面を返す', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      playingCourt(2, startedAtForElapsed(90_000)),
      playingCourt(3, startedAtForElapsed(10_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1, 2]);
  });
});

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

  it('4:30 未満でも出す（段階は waiting）', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 1))] }),
    );
    expect(guide?.phase).toBe('waiting');
    expect(guide?.courtIds).toEqual([1]);
  });

  it('試合開始直後でも待機場所を出す', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(3, startedAtForElapsed(1_000))] }),
    );
    expect(guide?.phase).toBe('waiting');
    expect(guide?.courtIds).toEqual([3]);
  });

  it('4:30 ちょうどで imminent になる', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))] }),
    );
    expect(guide?.phase).toBe('imminent');
    expect(guide?.courtIds).toEqual([2]);
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

  it('複数コートがプレイ中で経過が離れていれば最大のコートを指す', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS + 120_000)),
          playingCourt(3, startedAtForElapsed(10_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide?.courtIds).toEqual([2]);
  });

  it('開始が近い2面は両方を指す', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 30_000)),
          playingCourt(3, startedAtForElapsed(10_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide?.courtIds).toEqual([1, 2]);
  });

  it('3面同時開始なら番号を出さない', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(120_000), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(120_000)),
          playingCourt(3, startedAtForElapsed(120_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide).not.toBeNull();
    expect(guide?.courtIds).toEqual([]);
  });

  it('空きコートがあってもプレイ中コートを指す（callBasisCourtId との差分）', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [emptyCourt(1), playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
      }),
    );
    expect(guide?.courtIds).toEqual([2]);
  });

  it('showCourtNumber が false なら courtIds は空', () => {
    const guide = buildFinishOperationGuide(args({ showCourtNumber: false }));
    expect(guide).not.toBeNull();
    expect(guide?.courtIds).toEqual([]);
  });
});

describe('buildFinishOperationGuideHeadline', () => {
  const guideWith = (courtIds: number[]): FinishOperationGuide => ({
    phase: 'imminent',
    courtIds,
    playerIds: ['w1'],
  });

  it('コート番号は丸数字（コートカードの丸バッジと揃える）', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([1]))).toBe('①付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([2]))).toBe('②付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([3]))).toBe('③付近待機');
  });

  it('近接2面は区切り無しで並べる', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([1, 2]))).toBe('①②付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([2, 4]))).toBe('②④付近待機');
  });

  it('丸数字が無い範囲は素の数字＋コートに戻す', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([21]))).toBe('21コート付近待機');
  });

  it('コート番号が無ければ番号を省く（1面運用・3面同時開始）', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([]))).toBe('コート付近待機');
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

describe('canFinishGame', () => {
  it('管理者（作成者 / 管理権限 / 開発モード）は常に押せる', () => {
    expect(
      canFinishGame({ isAdmin: true, certainIds: new Set(['a']), myPlayerId: 'b' }),
    ).toBe(true);
  });

  it('操作担当（ほぼ確定メンバー）は押せる', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a', 'b']), myPlayerId: 'b' }),
    ).toBe(true);
  });

  it('担当が居るのに自分が担当でなければ押せない', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a']), myPlayerId: 'b' }),
    ).toBe(false);
  });

  it('担当が居て自分の Player を特定できなければ押せない', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a']), myPlayerId: null }),
    ).toBe(false);
  });

  it('担当が 1 人も居なければ全員押せる（フォールバック）', () => {
    expect(canFinishGame({ isAdmin: false, certainIds: new Set(), myPlayerId: 'b' })).toBe(true);
  });

  it('担当が居らず自分の Player を特定できなくても押せる（フォールバック）', () => {
    expect(canFinishGame({ isAdmin: false, certainIds: new Set(), myPlayerId: null })).toBe(true);
  });
});
