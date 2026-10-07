import { describe, it, expect } from 'vitest';
import type { GameState } from '../services/sessionService';
import {
  collectPlayedPlayerNames,
  parseProgressTable,
  matchTargetsToRows,
  parseUserListHtml,
  resolveRealNames,
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
      { serial: '9', fullName: '不明', displayName: '不明' },
    ]);
  });

  it('対応が取れない行は名前セル文言をフルネームとする', () => {
    expect(parseProgressTable([{ serial: '3', nameText: '鈴木 一郎' }], [])).toEqual([
      { serial: '3', fullName: '鈴木 一郎', displayName: '鈴木 一郎' },
    ]);
  });

  it('通番が空の行は除外', () => {
    expect(parseProgressTable([{ serial: 'x', nameText: 'a' }], [])).toEqual([]);
  });
});

describe('parseUserListHtml', () => {
  const html = `<table>
    <tr><th>ID</th><th>名前</th><th>フリガナ</th><th>ニックネーム</th></tr>
    <tr><td>1</td><td>星野&nbsp;真吾</td><td>ホシノ</td><td>しんご</td></tr>
    <tr><td>2</td><td>山田 太郎</td><td>ヤマダ</td><td>Tom &amp; Jerry</td></tr>
    <tr><td>3</td><td>空</td><td></td><td></td></tr>
  </table>`;
  it('ヘッダから列を特定して本名とニックネームを返す', () => {
    expect(parseUserListHtml(html)).toEqual([
      { realName: '星野 真吾', nickname: 'しんご' },
      { realName: '山田 太郎', nickname: 'Tom & Jerry' },
    ]);
  });
  it('ヘッダが無ければ空', () => {
    expect(parseUserListHtml('<table><tr><td>a</td></tr></table>')).toEqual([]);
    expect(parseUserListHtml('')).toEqual([]);
  });
});

describe('resolveRealNames', () => {
  const users = [
    { realName: '星野 真吾', nickname: 'しんご' },
    { realName: '山田太郎', nickname: 'たろう' },
  ];
  it('ニックネーム一致 → 本名一致（正表記）→ 未解決', () => {
    const r = resolveRealNames(['しんご', '山田 太郎', '外部'], users);
    expect(r.resolved).toEqual([
      { name: 'しんご', realName: '星野 真吾' },
      { name: '山田 太郎', realName: '山田太郎' },
    ]);
    expect(r.unresolved).toEqual(['外部']);
  });
});

describe('matchTargetsToRows', () => {
  const rows = [
    { serial: '1', fullName: '星野　真吾', displayName: 'しんご' },
    { serial: '2', fullName: '山田太郎', displayName: '山田 太郎' },
    { serial: '3', fullName: '鈴木一郎', displayName: 'いちろう' },
  ];
  it('本名で空白差を無視して照合し、進行表に居ない人を返す', () => {
    const r = matchTargetsToRows(rows, [
      { name: 'しんご', realName: '星野 真吾' },
      { name: 'たろう', realName: '山田太郎' },
      { name: '欠席', realName: '佐藤 花子' },
    ]);
    expect(r.toRegister.map((x) => x.row.serial)).toEqual(['1', '2']);
    expect(r.toRegister[0]).toMatchObject({ nickname: 'しんご', realName: '星野 真吾' });
    expect(r.notFound).toEqual([{ name: '欠席', realName: '佐藤 花子' }]);
  });
  it('displayName が本名と一致しても可', () => {
    const r = matchTargetsToRows(
      [{ serial: '9', fullName: '9番', displayName: '佐藤花子' }],
      [{ name: 'はな', realName: '佐藤 花子' }],
    );
    expect(r.toRegister.map((x) => x.row.serial)).toEqual(['9']);
  });
  it('同一行を指す重複対象は1回のみ', () => {
    const r = matchTargetsToRows(rows, [
      { name: 'しんご', realName: '星野 真吾' },
      { name: '星野', realName: '星野真吾' },
    ]);
    expect(r.toRegister).toHaveLength(1);
  });
  it('normalizeName', () => {
    expect(normalizeName(' a　b c ')).toBe('abc');
  });
});
