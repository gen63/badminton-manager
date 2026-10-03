import { describe, it, expect } from 'vitest';
import { computeAffinityPairs, computeStrongPairs } from './pairPreference';
import type { PairPreference } from '../types/pairPreference';
import type { Player } from '../types/player';

/** テスト用プレイヤー生成 */
function makePlayer(id: string, gamesPlayed: number): Player {
  return {
    id,
    name: `Player ${id}`,
    isResting: false,
    gamesPlayed,
    lastPlayedAt: 0,
    activatedAt: 0,
  };
}

function makePref(
  id: string,
  a: string,
  b: string,
  strength: PairPreference['strength'] = 'normal',
): PairPreference {
  return { id, playerIds: [a, b], strength, createdAt: 0 };
}

describe('computeAffinityPairs', () => {
  // 2026-09-01: 飽和（実績比率ベースの deficit・TARGET_RATIO）を廃止したため、
  // 「機会0」「目標到達」「目標超過」「strong は targetRatio 1.0」という
  // 実績比率まわりのテストは意味を失った。常に最大強度で対象になる新仕様に
  // 合わせて書き直す（公平性ガード・候補プールフィルタのテストはそのまま残す）。

  it('対象ペアは常に含まれる（実績に関係なく最大強度）', () => {
    const players = [makePlayer('a', 4), makePlayer('b', 4)];
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map());
    expect(result).toEqual([{ a: 'a', b: 'b' }]);
  });

  it('normal / strong で対象判定は変わらない（違いはハード制約側だけ）', () => {
    const players = [makePlayer('a', 4), makePlayer('b', 4)];
    const normalResult = computeAffinityPairs(
      [makePref('p1', 'a', 'b', 'normal')], players, new Map(),
    );
    const strongResult = computeAffinityPairs(
      [makePref('p1', 'a', 'b', 'strong')], players, new Map(),
    );
    expect(normalResult).toEqual([{ a: 'a', b: 'b' }]);
    expect(strongResult).toEqual([{ a: 'a', b: 'b' }]);
  });

  it('片方未出場（候補プールにいない）は対象外', () => {
    const players = [makePlayer('a', 4)]; // b は候補プールにいない
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map());
    expect(result).toEqual([]);
  });

  it('公平性ガード（3b）: 期待差が閾値以上のメンバーを含むと対象外になる', () => {
    const players = [makePlayer('a', 2), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b')];
    const diffs = new Map<string, number | null>([['a', 1.5], ['b', -1.5]]);
    expect(computeAffinityPairs(prefs, players, diffs)).toEqual([]);
  });

  it('公平性ガードの境界: 閾値未満（丸め後）なら通常どおり対象になる。null は対象外にしない', () => {
    const players = [makePlayer('a', 1), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b')];
    const diffs = new Map<string, number | null>([['a', 1.44], ['b', null]]);
    expect(computeAffinityPairs(prefs, players, diffs)).toEqual([{ a: 'a', b: 'b' }]);
  });

  it('希望が0件なら空配列', () => {
    expect(computeAffinityPairs([], [], new Map())).toEqual([]);
  });
});

describe('computeStrongPairs', () => {
  it('strength: strong のペアだけを StrongPair[] として抽出する', () => {
    const players = [makePlayer('a', 0), makePlayer('b', 0), makePlayer('c', 0), makePlayer('d', 0)];
    const prefs = [
      makePref('p1', 'a', 'b', 'normal'),
      makePref('p2', 'c', 'd', 'strong'),
    ];
    const result = computeStrongPairs(prefs, players);
    expect(result).toEqual([{ a: 'c', b: 'd' }]);
  });

  it('片方が候補プールにいない strong ペアは対象外', () => {
    const players = [makePlayer('a', 0)]; // b はいない
    const prefs = [makePref('p1', 'a', 'b', 'strong')];
    expect(computeStrongPairs(prefs, players)).toEqual([]);
  });

  it('公平性ガードの影響を受けない（試合数超過でも strong は残る）', () => {
    // computeAffinityPairs とは違い、ここには medianGames / blockThreshold の引数自体が無い
    const players = [makePlayer('a', 100), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b', 'strong')];
    expect(computeStrongPairs(prefs, players)).toEqual([{ a: 'a', b: 'b' }]);
  });

  it('希望が0件なら空配列', () => {
    expect(computeStrongPairs([], [])).toEqual([]);
  });
});
