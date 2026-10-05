import { describe, it, expect } from 'vitest';
import type { Player } from '../types/player';
import {
  describeLateChange,
  formatStayOffsetTime,
  isStayStartAdjusted,
  LATE_CHANGE_EFFECT_TEXT,
  lateChangeEffect,
  restrainOffsetOption,
  RELIEF_GRACE_MIN,
  showReliefOptions,
  lateMinutes,
  parseStayOffsetTime,
  applyLateRelief,
  buildArrivalAdjustmentUpdate,
  formatReliefRatio,
  isLateReliefReserved,
  isValidLateReliefRatio,
  reliefReservationNote,
  resolveActualStayStart,
  resolveStayStart,
} from './stayStart';

// docs/plans/2026-10-05-stay-start-override.md
const MIN = 60_000;
const START = new Date(2026, 9, 5, 19, 0, 0, 0).getTime(); // 練習開始 19:00（ローカル時刻）
const NOW = START + 180 * MIN; // 22:00

const mk = (overrides: Partial<Player> = {}): Player => ({
  id: 'a',
  name: 'a',
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: START + 120 * MIN,
  operationStatus: { payment: true, roster: true, checkin: false },
  opsCompletedAt: START + 120 * MIN, // 受付完了は 21:00（120分遅刻）
  ...overrides,
});

describe('resolveStayStart - 到着調整（stayStartOffsetMin）', () => {
  it('未設定なら従来ルール（opsCompletedAt）', () => {
    expect(resolveStayStart(mk(), START, NOW)).toBe(START + 120 * MIN);
  });

  it('実際より早い設定（遅刻連絡あり）: 練習開始＋分数が起点', () => {
    expect(resolveStayStart(mk({ stayStartOffsetMin: 30 }), START, NOW)).toBe(START + 30 * MIN);
  });

  it('実際より遅い設定（体調不良など）も効く', () => {
    expect(resolveStayStart(mk({ opsCompletedAt: START, stayStartOffsetMin: 90 }), START, NOW)).toBe(START + 90 * MIN);
  });

  it('負の値は 0（練習開始）で頭打ち', () => {
    expect(resolveStayStart(mk({ stayStartOffsetMin: -30 }), START, NOW)).toBe(START);
  });

  it('未来になる値は now で頭打ち（滞在0）', () => {
    expect(resolveStayStart(mk({ stayStartOffsetMin: 240 }), START, NOW)).toBe(NOW);
  });

  it('会費・名簿が未完了なら設定があっても now（滞在0）', () => {
    const p = mk({
      operationStatus: { payment: true, roster: false, checkin: false },
      opsCompletedAt: undefined,
      stayStartOffsetMin: 0,
    });
    expect(resolveStayStart(p, START, NOW)).toBe(NOW);
  });

  it('opsCompletedAt がない既存データでも設定が優先される', () => {
    expect(resolveStayStart(mk({ opsCompletedAt: undefined, stayStartOffsetMin: 10 }), START, NOW)).toBe(START + 10 * MIN);
  });

  it('練習開始時刻が無い（0）セッションでは設定を無視する', () => {
    const p = mk({ stayStartOffsetMin: 10 });
    expect(resolveStayStart(p, 0, NOW)).toBe(START + 120 * MIN);
  });

  it('練習開始時刻を動かしても遅刻幅（分数）が保たれる', () => {
    const p = mk({ opsCompletedAt: undefined, activatedAt: 1, stayStartOffsetMin: 20 });
    const otherStart = START + 24 * 60 * MIN;
    expect(resolveStayStart(p, otherStart, otherStart + 60 * MIN) - otherStart).toBe(20 * MIN);
  });
});

describe('resolveActualStayStart', () => {
  it('到着調整を無視して従来ルールの起点を返す（known）', () => {
    expect(resolveActualStayStart(mk({ stayStartOffsetMin: 0 }), START, NOW)).toEqual({ status: 'known', start: START + 120 * MIN });
  });
  it('練習開始より前の完了は練習開始で頭打ち', () => {
    expect(resolveActualStayStart(mk({ opsCompletedAt: START - 10 * MIN }), START, NOW)).toEqual({ status: 'known', start: START });
  });
  it('opsCompletedAt がなく activatedAt > 0 なら activatedAt（known）', () => {
    expect(resolveActualStayStart(mk({ opsCompletedAt: undefined, activatedAt: START + 30 * MIN }), START, NOW)).toEqual({
      status: 'known',
      start: START + 30 * MIN,
    });
  });
  it('opsCompletedAt も activatedAt も無ければ unknown（start は従来どおり）', () => {
    expect(resolveActualStayStart(mk({ opsCompletedAt: undefined, activatedAt: 0 }), START, NOW)).toEqual({ status: 'unknown', start: START });
    const legacy = mk({ opsCompletedAt: undefined, activatedAt: undefined as unknown as number });
    expect(resolveActualStayStart(legacy, START, NOW)).toEqual({ status: 'unknown', start: NOW });
  });
  it('会費・名簿が未完了なら notArrived', () => {
    const p = mk({ operationStatus: { payment: false, roster: true, checkin: false } });
    expect(resolveActualStayStart(p, START, NOW)).toEqual({ status: 'notArrived' });
  });
});

describe('isStayStartAdjusted（「到着調整」バッジの条件）', () => {
  it('起点が変わるなら true', () => {
    expect(isStayStartAdjusted(mk({ stayStartOffsetMin: 60 }), START, NOW)).toBe(true);
  });
  it('未設定は false', () => {
    expect(isStayStartAdjusted(mk(), START, NOW)).toBe(false);
  });
  it('頭打ちで結果が変わらない（定刻の人に負の値）なら false', () => {
    expect(isStayStartAdjusted(mk({ opsCompletedAt: START - 5 * MIN, stayStartOffsetMin: -10 }), START, NOW)).toBe(false);
  });
  it('実際と同じ分数なら false', () => {
    expect(isStayStartAdjusted(mk({ stayStartOffsetMin: 120 }), START, NOW)).toBe(false);
  });
  it('未完了・練習開始時刻なしは false', () => {
    const p = mk({ operationStatus: { payment: false, roster: false, checkin: false }, stayStartOffsetMin: 10 });
    expect(isStayStartAdjusted(p, START, NOW)).toBe(false);
    expect(isStayStartAdjusted(mk({ stayStartOffsetMin: 10 }), 0, NOW)).toBe(false);
  });
});

describe('lateMinutes', () => {
  it('練習開始からの分（四捨五入）', () => {
    expect(lateMinutes(START + 40 * MIN, START)).toBe(40);
    expect(lateMinutes(START + 40 * MIN + 31_000, START)).toBe(41);
    expect(lateMinutes(START + 40 * MIN + 29_000, START)).toBe(40);
  });
  it('開始前・定刻は 0', () => {
    expect(lateMinutes(START, START)).toBe(0);
    expect(lateMinutes(START - 10 * MIN, START)).toBe(0);
  });
});

describe('applyLateRelief', () => {
  it('遅刻幅に倍率を掛ける', () => {
    expect(applyLateRelief(START + 40 * MIN, START, 1 / 2)).toBe(START + 20 * MIN);
    expect(applyLateRelief(START + 30 * MIN, START, 1 / 3)).toBe(START + 10 * MIN);
    expect(applyLateRelief(START + 40 * MIN, START, 0)).toBe(START);
  });
  it('遅刻なし（0 以下）は練習開始のまま', () => {
    expect(applyLateRelief(START, START, 0.5)).toBe(START);
    expect(applyLateRelief(START - 10 * MIN, START, 0.5)).toBe(START);
  });
});

describe('formatStayOffsetTime / parseStayOffsetTime', () => {
  it('表示は練習開始＋分数', () => {
    expect(formatStayOffsetTime(40, START)).toBe('19:40');
    expect(formatStayOffsetTime(undefined, START)).toBe('');
    expect(formatStayOffsetTime(40, 0)).toBe('');
  });

  it('開始以降の時刻はその分数', () => {
    expect(parseStayOffsetTime('19:40', START)).toBe(40);
    expect(parseStayOffsetTime('19:00', START)).toBe(0);
  });

  it('開始より少し前（12時間未満）は遅刻なし＝0分', () => {
    expect(parseStayOffsetTime('18:50', START)).toBe(0);
    expect(parseStayOffsetTime('07:01', START)).toBe(0); // 11時間59分前
  });

  it('開始より12時間以上前なら翌日とみなす（日付をまたぐ練習）', () => {
    expect(parseStayOffsetTime('07:00', START)).toBe(12 * 60); // ちょうど12時間前 → 翌 07:00
    const lateStart = new Date(2026, 9, 5, 23, 0).getTime();
    expect(parseStayOffsetTime('00:30', lateStart)).toBe(90);
    expect(formatStayOffsetTime(90, lateStart)).toBe('00:30');
  });

  it('空・不正な形式・練習開始時刻なしは null', () => {
    expect(parseStayOffsetTime('', START)).toBeNull();
    expect(parseStayOffsetTime('25:00', START)).toBeNull();
    expect(parseStayOffsetTime('abc', START)).toBeNull();
    expect(parseStayOffsetTime('19:40', 0)).toBeNull();
  });
});

describe('describeLateChange', () => {
  it('実際のみ', () => {
    expect(describeLateChange(40, null)).toBe('遅刻 40分');
    expect(describeLateChange(0, null)).toBe('遅刻なし');
  });
  it('救済で短くなる', () => {
    expect(describeLateChange(40, 20)).toBe('遅刻 40分 → 20分（-20分）');
  });
  it('調整後の方が遅い（体調不良など）', () => {
    expect(describeLateChange(0, 30)).toBe('遅刻 0分 → 30分（+30分）');
  });
  it('変化なし', () => {
    expect(describeLateChange(15, 15)).toBe('遅刻 15分 → 15分（±0分）');
  });
  it('受付完了時刻が無い場合は調整側だけ / どちらもなければ空', () => {
    expect(describeLateChange(null, 20)).toBe('調整後の遅刻 20分');
    expect(describeLateChange(null, null)).toBe('');
  });
});

describe('restrainOffsetOption（控えめボタン）', () => {
  const END = START + 180 * MIN; // 22:00 終了
  it('実際の遅刻分 + N分（定刻の人は N分）', () => {
    expect(restrainOffsetOption(0, 30, START, END)).toEqual({ offsetMin: 30, disabled: false });
    expect(restrainOffsetOption(20, 15, START, END)).toEqual({ offsetMin: 35, disabled: false });
  });
  it('実際の起点基準なので何度計算しても累積しない', () => {
    const first = restrainOffsetOption(10, 30, START, END);
    expect(restrainOffsetOption(10, 30, START, END)).toEqual(first);
  });
  it('練習終了時刻以降になるなら無効', () => {
    expect(restrainOffsetOption(150, 30, START, END)).toEqual({ offsetMin: 180, disabled: true });
    expect(restrainOffsetOption(150, 15, START, END).disabled).toBe(false);
  });
  it('練習終了時刻が無ければ無効にしない', () => {
    expect(restrainOffsetOption(500, 60, START, undefined).disabled).toBe(false);
  });
});

describe('lateChangeEffect / LATE_CHANGE_EFFECT_TEXT', () => {
  it('縮んだら easier、増えたら restrained', () => {
    expect(lateChangeEffect(40, 20)).toBe('easier');
    expect(lateChangeEffect(0, 30)).toBe('restrained');
    expect(LATE_CHANGE_EFFECT_TEXT.easier).toBe('→ 試合に入りやすくなります');
    expect(LATE_CHANGE_EFFECT_TEXT.restrained).toBe('→ 試合数が控えめになります');
  });
  it('変化なし・未入力・受付完了時刻なしは null', () => {
    expect(lateChangeEffect(15, 15)).toBeNull();
    expect(lateChangeEffect(15, null)).toBeNull();
    expect(lateChangeEffect(null, 20)).toBeNull();
  });
});

describe('showReliefOptions（救済グループの表示条件）', () => {
  it('猶予は10分', () => expect(RELIEF_GRACE_MIN).toBe(10));
  it('10分以内は出さず、11分から出す', () => {
    expect(showReliefOptions('known', 0, false)).toBe(false);
    expect(showReliefOptions('known', 10, false)).toBe(false);
    expect(showReliefOptions('known', 11, false)).toBe(true);
  });
  it('受付完了時刻が分からない（null）なら出さない', () => {
    expect(showReliefOptions('unknown', null, false)).toBe(false);
  });
  it('未到着は猶予にかかわらず常に出す（到着前の予約用）', () => {
    expect(showReliefOptions('notArrived', null, false)).toBe(true);
  });
  it('倍率が設定済みなら猶予にかかわらず出す（選択状態を見せる）', () => {
    expect(showReliefOptions('known', 5, true)).toBe(true);
    expect(showReliefOptions('unknown', null, true)).toBe(true);
  });
});

describe('resolveStayStart - 遅刻救済の倍率（lateReliefRatio）', () => {
  // mk() の受付完了は練習開始＋120分
  it('会費・名簿が未完了なら倍率があっても now', () => {
    const p = mk({ operationStatus: { payment: false, roster: true, checkin: false }, opsCompletedAt: undefined, lateReliefRatio: 0.5 });
    expect(resolveStayStart(p, START, NOW)).toBe(NOW);
  });
  it('0.5 なら遅刻幅半分', () => {
    expect(resolveStayStart(mk({ lateReliefRatio: 0.5 }), START, NOW)).toBe(START + 60 * MIN);
  });
  it('1/3 なら遅刻幅 1/3', () => {
    expect(resolveStayStart(mk({ lateReliefRatio: 1 / 3 }), START, NOW)).toBe(START + 40 * MIN);
  });
  it('0 なら練習開始（遅刻なしとみなす）', () => {
    expect(resolveStayStart(mk({ lateReliefRatio: 0 }), START, NOW)).toBe(START);
  });
  it('遅刻していなければ練習開始のまま', () => {
    expect(resolveStayStart(mk({ opsCompletedAt: START - 5 * MIN, lateReliefRatio: 0.5 }), START, NOW)).toBe(START);
  });
  it('now で頭打ち', () => {
    // 受付完了が now より後（端末時刻ずれ等）でも now を超えない
    const p = mk({ opsCompletedAt: NOW + 60 * MIN, lateReliefRatio: 1 });
    expect(resolveStayStart(p, START, NOW)).toBe(NOW);
  });
  it('練習開始時刻が無い（0）なら倍率を無視', () => {
    expect(resolveStayStart(mk({ lateReliefRatio: 0 }), 0, NOW)).toBe(START + 120 * MIN);
  });
  it('受付完了時刻が unknown でも従来の起点に倍率を当てる', () => {
    const p = mk({ opsCompletedAt: undefined, activatedAt: 0, lateReliefRatio: 0.5 });
    // unknown の起点は練習開始（遅刻0）→ 練習開始のまま
    expect(resolveStayStart(p, START, NOW)).toBe(START);
  });
  it('到着調整バッジ・遅刻連絡バッジの判定', () => {
    expect(isStayStartAdjusted(mk({ lateReliefRatio: 0.5 }), START, NOW)).toBe(true);
    expect(isStayStartAdjusted(mk({ opsCompletedAt: START, lateReliefRatio: 0.5 }), START, NOW)).toBe(false);
    const pending = mk({ operationStatus: { payment: false, roster: false, checkin: false }, lateReliefRatio: 0.5 });
    expect(isLateReliefReserved(pending, START, NOW)).toBe(true);
    expect(isLateReliefReserved(pending, 0, NOW)).toBe(false);
    expect(isLateReliefReserved(mk({ lateReliefRatio: 0.5 }), START, NOW)).toBe(false);
  });
});

describe('isValidLateReliefRatio', () => {
  it('有限で 0〜1 のみ', () => {
    expect(isValidLateReliefRatio(0)).toBe(true);
    expect(isValidLateReliefRatio(1 / 3)).toBe(true);
    expect(isValidLateReliefRatio(1)).toBe(true);
    expect(isValidLateReliefRatio(-0.1)).toBe(false);
    expect(isValidLateReliefRatio(1.5)).toBe(false);
    expect(isValidLateReliefRatio(NaN)).toBe(false);
    expect(isValidLateReliefRatio('0.5')).toBe(false);
  });
});

describe('倍率の表示（formatReliefRatio / reliefReservationNote / describeLateChange）', () => {
  it('ラベル', () => {
    expect(formatReliefRatio(0.5)).toBe('1/2');
    expect(formatReliefRatio(1 / 3)).toBe('1/3');
    expect(formatReliefRatio(0)).toBe('0');
    expect(formatReliefRatio(0.25)).toBe('25%');
  });
  it('予約の注記', () => {
    expect(reliefReservationNote(0.5)).toBe('受付完了時に遅刻幅を 1/2 にします');
  });
  it('倍率指定時の推移は（1/2）表記', () => {
    expect(describeLateChange(40, 20, 0.5)).toBe('遅刻 40分 → 20分（1/2）');
  });
});

describe('buildArrivalAdjustmentUpdate（モーダルの保存内容）', () => {
  const parse = (t: string) => parseStayOffsetTime(t, START);
  const none = { ratio: null, offsetText: '' };
  it('変更なしは空', () => {
    expect(buildArrivalAdjustmentUpdate(none, none, parse)).toEqual({});
    expect(buildArrivalAdjustmentUpdate({ ratio: 0.5, offsetText: '' }, { ratio: 0.5, offsetText: '' }, parse)).toEqual({});
    expect(buildArrivalAdjustmentUpdate({ ratio: null, offsetText: '19:30' }, { ratio: null, offsetText: '19:30' }, parse)).toEqual({});
  });
  it('倍率を選ぶ／変える', () => {
    expect(buildArrivalAdjustmentUpdate(none, { ratio: 0.5, offsetText: '' }, parse)).toEqual({ lateReliefRatio: 0.5 });
    expect(buildArrivalAdjustmentUpdate({ ratio: null, offsetText: '19:30' }, { ratio: 0, offsetText: '' }, parse)).toEqual({ lateReliefRatio: 0 });
  });
  it('倍率を解除', () => {
    expect(buildArrivalAdjustmentUpdate({ ratio: 0.5, offsetText: '' }, none, parse)).toEqual({ lateReliefRatio: null });
  });
  it('倍率から手入力の時刻へ切り替え', () => {
    expect(buildArrivalAdjustmentUpdate({ ratio: 0.5, offsetText: '' }, { ratio: null, offsetText: '19:20' }, parse)).toEqual({ stayStartOffsetMin: 20 });
  });
  it('時刻の設定・解除・不正', () => {
    expect(buildArrivalAdjustmentUpdate(none, { ratio: null, offsetText: '19:45' }, parse)).toEqual({ stayStartOffsetMin: 45 });
    expect(buildArrivalAdjustmentUpdate({ ratio: null, offsetText: '19:45' }, none, parse)).toEqual({ stayStartOffsetMin: null });
    expect(buildArrivalAdjustmentUpdate(none, { ratio: null, offsetText: 'xx' }, parse)).toBe('invalid');
  });
});
