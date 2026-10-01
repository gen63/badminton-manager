/**
 * 連続出場数（`buildStreakById`）と進行中コートの開始時刻（`courtStartTimes`）の単体テスト。
 * `docs/plans/2026-10-01-recency-just-finished-streak.md`
 *
 * 定義: 「最後の試合の終了以降に他の試合が1つも開始していない」人だけが連続候補。
 * 連鎖は、連続する2出場の間（終了〜次の開始）に他の試合の開始が無い限り数える。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Match } from '../../types/match';
import { buildStreakById, courtStartTimes } from './streak';

const MIN = 60_000;

let seq = 0;
/** 試合を作る。時刻は分単位（開始, 終了） */
function match(
  courtId: number,
  teamA: [string, string],
  teamB: [string, string],
  startMin: number,
  finishMin: number
): Match {
  return {
    id: `m${seq++}`,
    courtId,
    teamA,
    teamB,
    scoreA: 0,
    scoreB: 0,
    startedAt: startMin * MIN,
    finishedAt: finishMin * MIN,
  };
}

const A: [string, string] = ['a1', 'a2'];
const B: [string, string] = ['b1', 'b2'];
const C: [string, string] = ['c1', 'c2'];
const D: [string, string] = ['d1', 'd2'];

describe('buildStreakById（連続の判定）', () => {
  it('履歴が空なら空 Map', () => {
    expect(buildStreakById([]).size).toBe(0);
  });

  it('1コートの連続モード: 直前の試合の4人だけが 1（その前の4人は連続ではない）', () => {
    // コート1: A,B(0-10) → C,D(10-20)。10分に C,D が開始＝A,B の終了以降に他の試合が始まった
    const history = [match(1, A, B, 0, 10), match(1, C, D, 10, 20)];
    const s = buildStreakById(history);
    expect(s.get('c1')).toBe(1);
    expect(s.get('d2')).toBe(1);
    expect(s.has('a1')).toBe(false);
    expect(s.has('b2')).toBe(false);
  });

  it('複数コート: 待機者のほぼ全員が連続扱いになる旧定義と違い、直前に終わったコートの4人だけが 1', () => {
    // 3コート。コート1,2,3 が 0 分開始。コート1 が 10 分終了→即再配置(10分開始)、
    // コート2 が 11 分終了。ここで判定する時点の履歴:
    //   m1: コート1 A,B   0-10
    //   m2: コート2 C,D   0-11  ← 直前に終わった
    // 進行中: コート1 の2試合目(10分開始)、コート3(0分開始)
    const history = [match(1, A, B, 0, 10), match(2, C, D, 0, 11)];
    const s = buildStreakById(history, [10 * MIN, 0]);
    // A,B は終了(10分)以降に「コート1の2試合目(10分開始)」が始まっている → 連続ではない
    expect(s.has('a1')).toBe(false);
    expect(s.has('b1')).toBe(false);
    // C,D は終了(11分)以降に始まった試合が無い → 連続候補
    expect(s.get('c1')).toBe(1);
    expect(s.get('d1')).toBe(1);
  });

  it('進行中コートの開始を渡さないと、他コートの試合を見落として連続と誤判定する', () => {
    const history = [match(1, A, B, 0, 10)];
    expect(buildStreakById(history).get('a1')).toBe(1); // 見えている範囲では誰も始まっていない
    expect(buildStreakById(history, [12 * MIN]).has('a1')).toBe(false); // 12分に他コートが開始
  });

  it('同時刻の開始は「終了後に始まった試合」に数える（連続モードは終了と配置が同一 ms になる）', () => {
    // コート1 の A,B が 10 分に終了し、同じ瞬間にコート1 へ C,D が配置される
    const history = [match(1, A, B, 0, 10)];
    expect(buildStreakById(history, [10 * MIN]).has('a1')).toBe(false);
  });

  it('連鎖: 終了直後に即再配置された人は 2 → 3 と伸びる', () => {
    // 1コート 8人。a は 0-10, 10-20, 20-30 と3試合連続で出た（間に他の開始は無い）
    // ただし他の4人（C,D）の試合は同コートなので a の2試合目と3試合目の「間」には入らない
    const history = [
      match(1, A, B, 0, 10),
      match(1, A, B, 10, 20),
      match(1, A, B, 20, 30),
    ];
    const s = buildStreakById(history);
    expect(s.get('a1')).toBe(3);
    expect(s.get('b2')).toBe(3);
  });

  it('連鎖: 間に他の試合が始まっていれば、そこで連続は途切れる', () => {
    // a: m1(0-10) → [コート2 が 12 分開始] → m3(15-25) 。a の連続は m3 の1のみ
    const history = [
      match(1, A, B, 0, 10),
      match(2, C, D, 12, 22),
      match(1, A, C, 15, 25),
    ];
    const s = buildStreakById(history);
    expect(s.get('a1')).toBe(1);
    expect(s.get('b1')).toBeUndefined(); // b は m1 の後に他の試合が始まった
  });

  it('3連続の途中に他の試合の開始が挟まると、挟まった所から前は数えない', () => {
    // a: m1(0-10), m2(10-20)  連続 / m3(25-35) の前に 22 分開始の他試合あり
    const history = [
      match(1, A, B, 0, 10),
      match(1, A, B, 10, 20),
      match(2, C, D, 22, 32),
      match(1, A, B, 25, 35),
    ];
    expect(buildStreakById(history).get('a1')).toBe(1);
  });

  it('履歴の並び順に依存しない（時刻だけを見る）', () => {
    const m1 = match(1, A, B, 0, 10);
    const m2 = match(1, A, B, 10, 20);
    const forward = buildStreakById([m1, m2]);
    const reversed = buildStreakById([m2, m1]);
    expect(reversed.get('a1')).toBe(forward.get('a1'));
    expect(forward.get('a1')).toBe(2);
  });

  it('手動配置: 空白時間があっても、その間に他の試合が始まっていなければ連続', () => {
    // 手動配置で A,B(0-10) の後、20 分まで誰も配置せず、20 分に A,B をもう一度配置
    // （他コートの試合は 0 分開始のまま進行中）。間に他の開始が無いので 2 連続
    const history = [match(1, A, B, 0, 10), match(1, A, B, 20, 30)];
    expect(buildStreakById(history, [0]).get('a1')).toBe(2);
    // 間の 15 分に他コートの試合が始まっていれば連鎖は切れる（直前の1試合だけ＝1）
    expect(buildStreakById(history, [0, 15 * MIN]).get('a1')).toBe(1);
  });

  it('旧データ（startedAt / finishedAt が 0）は判定不能として連続にしない', () => {
    const old: Match = { ...match(1, A, B, 0, 10), startedAt: 0, finishedAt: 0 };
    expect(buildStreakById([old]).size).toBe(0);
    // 最新の試合が正常でも、その前が旧データならそこで連鎖が止まる（落ちない）
    const history = [old, match(1, A, B, 10, 20)];
    expect(buildStreakById(history).get('a1')).toBe(1);
  });

  it('シングルスの空スロットは無視する', () => {
    const history = [match(1, ['a1', ''], ['b1', ''], 0, 10)];
    const s = buildStreakById(history);
    expect(s.get('a1')).toBe(1);
    expect(s.has('')).toBe(false);
  });

  it('Date.now() に依存しない（呼ばれても結果が変わらない・そもそも呼ばない）', () => {
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now() を呼んではいけない');
    });
    const history = [match(1, A, B, 0, 10), match(1, C, D, 10, 20)];
    expect(buildStreakById(history, [5 * MIN]).get('c1')).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('courtStartTimes（進行中コートの開始時刻）', () => {
  const court = (
    teamA: [string, string],
    startedAt: number,
    assignedAt?: number
  ) => ({ teamA, startedAt, assignedAt });

  it('配置済みコートの startedAt を拾い、空きコートは無視する', () => {
    expect(
      courtStartTimes([court(['a', 'b'], 100), court(['', ''], 0), court(['c', 'd'], 200)])
    ).toEqual([100, 200]);
  });

  it('準備中（startedAt 未設定）は配置時刻 assignedAt を使い、どちらも無ければ無視する', () => {
    expect(courtStartTimes([court(['a', 'b'], 0, 300), court(['c', 'd'], 0)])).toEqual([300]);
  });
});
