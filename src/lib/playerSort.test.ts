import { describe, it, expect } from 'vitest';
import { sortPlayers } from './playerSort';

interface TestPlayer {
  name: string;
  gamesPlayed: number;
}

const player = (name: string, gamesPlayed: number): TestPlayer => ({ name, gamesPlayed });

describe('sortPlayers', () => {
  it('games モード: 試合数が多い順に並ぶ', () => {
    const players = [player('A', 1), player('B', 3), player('C', 2)];
    expect(sortPlayers(players, 'games', {}).map((p) => p.name)).toEqual(['B', 'C', 'A']);
  });

  it('games モード: 試合数が同値なら名前昇順で安定化する', () => {
    const players = [player('ひろき', 2), player('あきら', 2), player('けん', 2)];
    expect(sortPlayers(players, 'games', {}).map((p) => p.name)).toEqual(['あきら', 'けん', 'ひろき']);
  });

  it('lastSeen モード: 最終参照が古い順（昇順）に並ぶ', () => {
    const players = [player('A', 0), player('B', 0), player('C', 0)];
    const lastSeen = { A: 3000, B: 1000, C: 2000 };
    expect(sortPlayers(players, 'lastSeen', lastSeen).map((p) => p.name)).toEqual(['B', 'C', 'A']);
  });

  it('lastSeen モード: 未閲覧（lastSeen エントリ無し）が最上位', () => {
    const players = [player('A', 0), player('B', 0), player('C', 0)];
    const lastSeen = { A: 1000, C: 2000 }; // B はエントリ無し = 未閲覧
    expect(sortPlayers(players, 'lastSeen', lastSeen).map((p) => p.name)).toEqual(['B', 'A', 'C']);
  });

  it('lastSeen モード: 同一 lastSeen は試合数の多い順で tie-break する', () => {
    const players = [player('A', 1), player('B', 3), player('C', 2)];
    const lastSeen = { A: 1000, B: 1000, C: 1000 };
    expect(sortPlayers(players, 'lastSeen', lastSeen).map((p) => p.name)).toEqual(['B', 'C', 'A']);
  });

  it('lastSeen モード: lastSeen・試合数とも同値なら名前昇順で tie-break する', () => {
    const players = [player('ひろき', 1), player('あきら', 1), player('けん', 1)];
    const lastSeen = { ひろき: 1000, あきら: 1000, けん: 1000 };
    expect(sortPlayers(players, 'lastSeen', lastSeen).map((p) => p.name)).toEqual(['あきら', 'けん', 'ひろき']);
  });

  it('lastSeen モード: 値が数値でない (NaN) 場合も未閲覧として先頭に寄せる', () => {
    const players = [player('A', 0), player('B', 0)];
    const lastSeen = { A: 1000, B: Number.NaN };
    expect(sortPlayers(players, 'lastSeen', lastSeen).map((p) => p.name)).toEqual(['B', 'A']);
  });

  it('入力配列を破壊しない', () => {
    const players = [player('A', 1), player('B', 3), player('C', 2)];
    const original = [...players];
    sortPlayers(players, 'games', {});
    expect(players).toEqual(original);
  });

  it('空配列を渡すと空配列を返す', () => {
    expect(sortPlayers([], 'games', {})).toEqual([]);
    expect(sortPlayers([], 'lastSeen', {})).toEqual([]);
  });
});
