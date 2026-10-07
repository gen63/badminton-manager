import { describe, it, expect } from 'vitest';
import type { GameState } from '../services/sessionService';
import {
  collectPlayedPlayerNames,
  parseProgressTable,
  matchTargetsToRows,
  normalizeName,
} from './etomoCheckin';

const mkMatch = (teamA: [string, string], teamB: [string, string], finishedAt: number) => ({
  id: Math.random().toString(),
  courtId: 1,
  teamA,
  teamB,
  scoreA: 0,
  scoreB: 0,
  startedAt: 1,
  finishedAt,
});

const player = (id: string, name: string) => ({ id, name });

describe('collectPlayedPlayerNames', () => {
  it('終了済み試合の出場者のみ・重複なし・空スロット除外・trim', () => {
    const state = {
      players: [player('a', ' 山田 '), player('b', 'B'), player('c', 'C'), player('d', 'D'), player('e', 'E')],
      courts: [],
      reservations: [],
      matchHistory: [
        mkMatch(['a', 'b'], ['c', ''], 100),
        mkMatch(['a', 'd'], ['b', 'c'], 200),
        mkMatch(['e', 'e'], ['x', ''], 0), // 未終了
      ],
    } as unknown as GameState;
    expect(collectPlayedPlayerNames(state)).toEqual(['山田', 'B', 'C', 'D']);
  });

  it('試合が無ければ空', () => {
    expect(collectPlayedPlayerNames({ players: [], courts: [], reservations: [], matchHistory: [] })).toEqual([]);
  });
});

describe('parseProgressTable', () => {
  it('通番と番号でフルネームに対応付ける', () => {
    const rows = [
      { serial: '1', nameText: 'しんご' },
      { serial: '２', nameText: 'たろう' },
      { serial: '9', nameText: '不明' },
    ];
    const members = [
      { no: '1', fullName: '星野 真吾' },
      { no: '2', fullName: '山田太郎' },
    ];
    expect(parseProgressTable(rows, members)).toEqual([
      { serial: '1', fullName: '星野 真吾', displayName: 'しんご' },
      { serial: '2', fullName: '山田太郎', displayName: 'たろう' },
    ]);
  });

  it('対応が取れなければ空', () => {
    expect(parseProgressTable([{ serial: 'x', nameText: 'a' }], [])).toEqual([]);
  });
});

describe('matchTargetsToRows', () => {
  const rows = [
    { serial: '1', fullName: '星野　真吾', displayName: 'しんご' },
    { serial: '2', fullName: '山田太郎', displayName: 'たろう' },
  ];
  it('空白差を無視して照合し、未一致を返す', () => {
    const r = matchTargetsToRows(rows, ['星野 真吾', '山田太郎', '外部1']);
    expect(r.toRegister.map((x) => x.serial)).toEqual(['1', '2']);
    expect(r.notFound).toEqual(['外部1']);
  });
  it('同一人物の重複対象は1回のみ', () => {
    expect(matchTargetsToRows(rows, ['山田太郎', '山田 太郎']).toRegister).toHaveLength(1);
  });
  it('normalizeName', () => {
    expect(normalizeName(' a　b c ')).toBe('abc');
  });
});
