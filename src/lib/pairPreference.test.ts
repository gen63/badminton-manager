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

const pairKeyOf = (a: string, b: string): string => [a, b].sort().join(',');

describe('computeAffinityPairs', () => {
  it('機会0（どちらも0試合）: opportunity は max(1, 0) = 1 で割り、achieved は 0 → deficit は targetRatio 分', () => {
    const players = [makePlayer('a', 0), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map(), pairKeyOf, 0, 2);
    expect(result).toEqual([{ a: 'a', b: 'b', deficit: 1 }]); // achieved=0 → deficit = clamp01((0.5-0)/0.5) = 1
  });

  it('目標到達（normal: achieved が targetRatio と一致）は deficit 0 で対象外', () => {
    // opportunity = min(4,4) = 4, targetRatio(normal) = 0.5 → actual = 2 で達成
    // medianGames は gamesPlayed と揃えて公平性ガードに触れないようにする
    const players = [makePlayer('a', 4), makePlayer('b', 4)];
    const prefs = [makePref('p1', 'a', 'b')];
    const partnerCounts = new Map([[pairKeyOf('a', 'b'), 2]]);
    const result = computeAffinityPairs(prefs, players, partnerCounts, pairKeyOf, 4, 2);
    expect(result).toEqual([]);
  });

  it('目標超過（achieved > targetRatio）も deficit 0（負にはならずクランプされ対象外）', () => {
    const players = [makePlayer('a', 4), makePlayer('b', 4)];
    const prefs = [makePref('p1', 'a', 'b')];
    const partnerCounts = new Map([[pairKeyOf('a', 'b'), 4]]); // achieved = 1.0 > 0.5
    const result = computeAffinityPairs(prefs, players, partnerCounts, pairKeyOf, 4, 2);
    expect(result).toEqual([]);
  });

  it('片方未出場（候補プールにいない）は対象外', () => {
    const players = [makePlayer('a', 4)]; // b は候補プールにいない
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map(), pairKeyOf, 0, 2);
    expect(result).toEqual([]);
  });

  it('公平性ガード（3b）: 試合数が中央値+閾値以上のメンバーを含むと deficit が 0（対象外）になる', () => {
    // 中央値 0、閾値 2 → gamesPlayed 2 以上のメンバーは保留
    const players = [makePlayer('a', 2), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map(), pairKeyOf, 0, 2);
    expect(result).toEqual([]);
  });

  it('公平性ガードの境界: 閾値未満なら通常どおり評価される', () => {
    // gamesPlayed 1 は 中央値0 + 閾値2 = 2 未満なのでガード対象外
    const players = [makePlayer('a', 1), makePlayer('b', 0)];
    const prefs = [makePref('p1', 'a', 'b')];
    const result = computeAffinityPairs(prefs, players, new Map(), pairKeyOf, 0, 2);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ a: 'a', b: 'b' });
  });

  it('strong は targetRatio 1.0 で判定される（normal なら達成扱いの実績でも strong は未達）', () => {
    const players = [makePlayer('a', 4), makePlayer('b', 4)];
    const partnerCounts = new Map([[pairKeyOf('a', 'b'), 2]]); // achieved = 0.5
    const normalResult = computeAffinityPairs(
      [makePref('p1', 'a', 'b', 'normal')], players, partnerCounts, pairKeyOf, 4, 2,
    );
    expect(normalResult).toEqual([]); // normal は 0.5 で目標達成済み

    const strongResult = computeAffinityPairs(
      [makePref('p1', 'a', 'b', 'strong')], players, partnerCounts, pairKeyOf, 4, 2,
    );
    expect(strongResult).toHaveLength(1);
    expect(strongResult[0].deficit).toBeCloseTo(0.5); // clamp01((1.0-0.5)/1.0)
  });

  it('希望が0件なら空配列', () => {
    expect(computeAffinityPairs([], [], new Map(), pairKeyOf, 0, 2)).toEqual([]);
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
