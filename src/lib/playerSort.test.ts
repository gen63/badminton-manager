import { describe, it, expect } from 'vitest';
import { sortPlayersByExpectedDiff } from './playerSort';
import type { ExpectedGames } from './playerStats';

const p = (name: string, gamesPlayed: number) => ({ id: name, name, gamesPlayed });
const exp = (entries: Record<string, number | null>) =>
  new Map<string, ExpectedGames>(
    Object.entries(entries).map(([id, diff]) => [id, { expected: diff === null ? null : 0, diff }]),
  );

describe('sortPlayersByExpectedDiff', () => {
  it('差が小さい順（足りていない人が上）', () => {
    const { others } = sortPlayersByExpectedDiff([p('a', 5), p('b', 5), p('c', 5)], exp({ a: 1.5, b: -2, c: 0 }), null);
    expect(others.map((x) => x.name)).toEqual(['b', 'c', 'a']);
  });

  it('差 null は差ありの後ろ、その中は試合数昇順 → 名前昇順', () => {
    const { others } = sortPlayersByExpectedDiff(
      [p('う', 3), p('あ', 1), p('い', 1), p('え', 9)],
      exp({ う: null, あ: null, い: null, え: 4 }),
      null,
    );
    expect(others.map((x) => x.name)).toEqual(['え', 'あ', 'い', 'う']);
  });

  it('差が同値なら名前昇順', () => {
    const { others } = sortPlayersByExpectedDiff([p('い', 2), p('あ', 2)], exp({ い: 0.5, あ: 0.5 }), null);
    expect(others.map((x) => x.name)).toEqual(['あ', 'い']);
  });

  it('currentUser は self に切り出され others から除外される', () => {
    const { self, others } = sortPlayersByExpectedDiff([p('a', 5), p('me', 9), p('c', 1)], exp({ a: 1, me: 3, c: -1 }), 'me');
    expect(self?.name).toBe('me');
    expect(others.map((x) => x.name)).toEqual(['c', 'a']);
  });

  it('currentUser が不在・未設定なら self は null', () => {
    expect(sortPlayersByExpectedDiff([p('a', 1)], exp({ a: 0 }), 'zzz').self).toBeNull();
    expect(sortPlayersByExpectedDiff([p('a', 1)], exp({ a: 0 }), null).self).toBeNull();
  });

  it('入力配列を破壊しない', () => {
    const input = [p('b', 1), p('a', 1)];
    sortPlayersByExpectedDiff(input, exp({ a: 0, b: 1 }), null);
    expect(input.map((x) => x.name)).toEqual(['b', 'a']);
  });
});
