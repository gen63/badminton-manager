import { describe, it, expect } from 'vitest';
import {
  shouldCallNextMatch,
  maxPlayingElapsedMs,
  callBasisCourtId,
  buildNextMatchCallMessage,
  sanitizeNameForSpeech,
} from './nextMatchCall';
import { MATCH_CALL_THRESHOLD_MS, MATCH_CALL_COOLDOWN_MS } from './gameOperations';
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

describe('maxPlayingElapsedMs', () => {
  it('プレイ中コートが無ければ 0', () => {
    expect(maxPlayingElapsedMs([emptyCourt(1)], NOW)).toBe(0);
  });

  it('プレイ中コートが無い（コート自体が無い）場合も 0', () => {
    expect(maxPlayingElapsedMs([], NOW)).toBe(0);
  });

  it('startedAt === 0（準備中コート）は経過時間の計算対象外', () => {
    const court: Court = { ...playingCourt(1, 0), startedAt: 0 };
    expect(maxPlayingElapsedMs([court], NOW)).toBe(0);
  });

  it('複数のプレイ中コートのうち最大の経過時間を返す', () => {
    const courts = [
      playingCourt(1, NOW - 3 * 60 * 1000),
      playingCourt(2, NOW - 7 * 60 * 1000),
      emptyCourt(3),
    ];
    expect(maxPlayingElapsedMs(courts, NOW)).toBe(7 * 60 * 1000);
  });
});

describe('shouldCallNextMatch', () => {
  const baseArgs = {
    courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS)],
    certainIds: new Set(['me']),
    myPlayerId: 'me',
    now: NOW,
    alreadyCalled: false,
    lastOnCourtAt: null,
  };

  it('閾値以上なら true', () => {
    expect(shouldCallNextMatch(baseArgs)).toBe(true);
  });

  it('閾値未満では false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - (MATCH_CALL_THRESHOLD_MS - 1))],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('certainIds に自分が居なければ false', () => {
    const args = { ...baseArgs, certainIds: new Set(['someone-else']) };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('alreadyCalled が true なら false', () => {
    const args = { ...baseArgs, alreadyCalled: true };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('自分が既にコートに乗っていれば false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS, ['me', 'p2'], ['p3', 'p4'])],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('自分が teamB に乗っている場合も false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - MATCH_CALL_THRESHOLD_MS, ['p1', 'p2'], ['me', 'p4'])],
    };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('myPlayerId が null なら false', () => {
    const args = { ...baseArgs, myPlayerId: null };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('プレイ中コートが無ければ false（maxPlayingElapsedMs が 0）', () => {
    const args = { ...baseArgs, courts: [emptyCourt(1)] };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('lastOnCourtAt がクールダウン内（30秒前）なら false', () => {
    const args = { ...baseArgs, lastOnCourtAt: NOW - 30 * 1000 };
    expect(shouldCallNextMatch(args)).toBe(false);
  });

  it('lastOnCourtAt がクールダウン経過（120秒前）なら true', () => {
    const args = { ...baseArgs, lastOnCourtAt: NOW - 120 * 1000 };
    expect(shouldCallNextMatch(args)).toBe(true);
  });

  it('lastOnCourtAt が null なら抑制しない', () => {
    const args = { ...baseArgs, lastOnCourtAt: null };
    expect(shouldCallNextMatch(args)).toBe(true);
  });

  it('lastOnCourtAt がちょうどクールダウン境界なら true（>=）', () => {
    const args = { ...baseArgs, lastOnCourtAt: NOW - MATCH_CALL_COOLDOWN_MS };
    expect(shouldCallNextMatch(args)).toBe(true);
  });
});

describe('callBasisCourtId', () => {
  it('空きコートがあればその ID', () => {
    const courts = [
      playingCourt(1, NOW - 5 * 60 * 1000),
      emptyCourt(2),
    ];
    expect(callBasisCourtId(courts, NOW)).toBe(2);
  });

  it('空きコートが複数あれば最小 ID', () => {
    const courts = [emptyCourt(3), emptyCourt(1), emptyCourt(2)];
    expect(callBasisCourtId(courts, NOW)).toBe(1);
  });

  it('空きが無ければ経過時間が最大のコート ID', () => {
    const courts = [
      playingCourt(1, NOW - 3 * 60 * 1000),
      playingCourt(2, NOW - 7 * 60 * 1000),
    ];
    expect(callBasisCourtId(courts, NOW)).toBe(2);
  });

  it('経過時間が同着なら小さい ID', () => {
    const courts = [
      playingCourt(2, NOW - 5 * 60 * 1000),
      playingCourt(1, NOW - 5 * 60 * 1000),
    ];
    expect(callBasisCourtId(courts, NOW)).toBe(1);
  });

  it('プレイ中も空きも無ければ null', () => {
    expect(callBasisCourtId([], NOW)).toBeNull();
  });

  it('準備中コート（startedAt === 0 かつメンバー配置済み）は空きでも経過時間対象でもない', () => {
    const preparing: Court = {
      ...playingCourt(1, 0),
      startedAt: 0,
    };
    // 配置済み（teamA[0] あり）なので空きコートではなく、
    // startedAt === 0 なので経過時間対象でもない → 該当コート無しで null
    expect(callBasisCourtId([preparing], NOW)).toBeNull();
  });

  it('準備中コートがあっても、他に空きコートがあればそちらを採用する', () => {
    const preparing: Court = { ...playingCourt(1, 0), startedAt: 0 };
    const courts = [preparing, emptyCourt(2)];
    expect(callBasisCourtId(courts, NOW)).toBe(2);
  });

  it('準備中コートがあっても、他にプレイ中コートがあればそちらを採用する', () => {
    const preparing: Court = { ...playingCourt(1, 0), startedAt: 0 };
    const courts = [preparing, playingCourt(2, NOW - 5 * 60 * 1000)];
    expect(callBasisCourtId(courts, NOW)).toBe(2);
  });
});

describe('buildNextMatchCallMessage', () => {
  it('名前ありのとき body は改行区切り、toast は括弧付き1行', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子']);
    expect(result.body).toBe('3コート付近で試合終了をお待ちください\n太郎さん・花子さん');
    expect(result.toast).toBe('3コート付近で試合終了をお待ちください（太郎さん・花子さん）');
  });

  it('名前なしのとき body・toast とも見出しのみ', () => {
    const result = buildNextMatchCallMessage(3, []);
    expect(result.body).toBe('3コート付近で試合終了をお待ちください');
    expect(result.toast).toBe('3コート付近で試合終了をお待ちください');
  });

  it('名前ありのとき speech は「名前 → 用件」・「。」区切り・「、」連結', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子']);
    expect(result.speech).toBe('太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('名前なしのとき speech は見出しのみ', () => {
    const result = buildNextMatchCallMessage(3, []);
    expect(result.speech).toBe('3コート付近で試合終了をお待ちください');
  });

  it('記号入りの名前は除去された形で読み上げられる', () => {
    const result = buildNextMatchCallMessage(3, ['ゆうき★', 'たろう(2)']);
    // 数字は残す文字クラスに含まれるため 2 はそのまま残り、括弧のみ除去される
    expect(result.speech).toBe('ゆうきさん、たろう2さん。3コート付近で試合終了をお待ちください');
    // body / toast には記号がそのまま残る（読み上げ専用の加工であることの確認）
    expect(result.body).toBe('3コート付近で試合終了をお待ちください\nゆうき★さん・たろう(2)さん');
    expect(result.toast).toBe('3コート付近で試合終了をお待ちください（ゆうき★さん・たろう(2)さん）');
  });

  it('記号のみの名前は読み上げ対象から外れる', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '★★']);
    expect(result.speech).toBe('太郎さん。3コート付近で試合終了をお待ちください');
  });

  it('絵文字入りの名前は除去される', () => {
    const result = buildNextMatchCallMessage(3, ['太郎🏸']);
    expect(result.speech).toBe('太郎さん。3コート付近で試合終了をお待ちください');
  });

  it('selfName を渡すと、その名前が読み上げの先頭に来る', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子', '次郎'], '花子');
    expect(result.speech).toBe('花子さん、太郎さん、次郎さん。3コート付近で試合終了をお待ちください');
  });

  it('selfName 以外の名前の相対順序は保たれる', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子', '次郎', '三郎'], '次郎');
    expect(result.speech).toBe(
      '次郎さん、太郎さん、花子さん、三郎さん。3コート付近で試合終了をお待ちください',
    );
  });

  it('selfName が名前リストに含まれない場合、順序は変わらない', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子'], '見知らぬ人');
    expect(result.speech).toBe('太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('selfName を渡さない場合、元の順序のまま「名前 → 用件」になる', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子']);
    expect(result.speech).toBe('太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('記号付きの selfName でも sanitize 後の比較で正しく先頭に来る', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', 'ゆうき', '花子'], 'ゆうき★');
    expect(result.speech).toBe('ゆうきさん、太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('selfName が既に先頭の場合も順序はそのまま', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子'], '太郎');
    expect(result.speech).toBe('太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('courtNumber が null のとき、名前ありで body・toast・speech すべてコート番号なしの見出しになる', () => {
    const result = buildNextMatchCallMessage(null, ['太郎', '花子']);
    expect(result.body).toBe('試合終了をお待ちください\n太郎さん・花子さん');
    expect(result.toast).toBe('試合終了をお待ちください（太郎さん・花子さん）');
    expect(result.speech).toBe('太郎さん、花子さん。試合終了をお待ちください');
  });

  it('courtNumber が null のとき、名前なしで body・toast・speech すべて見出しのみになる', () => {
    const result = buildNextMatchCallMessage(null, []);
    expect(result.body).toBe('試合終了をお待ちください');
    expect(result.toast).toBe('試合終了をお待ちください');
    expect(result.speech).toBe('試合終了をお待ちください');
  });

  it('courtNumber が null でも selfName の先頭寄せは従来どおり働く', () => {
    const result = buildNextMatchCallMessage(null, ['太郎', '花子', '次郎'], '花子');
    expect(result.speech).toBe('花子さん、太郎さん、次郎さん。試合終了をお待ちください');
  });
});

describe('sanitizeNameForSpeech', () => {
  it('ひらがな・カタカナ・漢字・英数字・長音符・々を残す', () => {
    expect(sanitizeNameForSpeech('たろうタロウ太郎ABC123ラーメン々')).toBe(
      'たろうタロウ太郎ABC123ラーメン々',
    );
  });

  it('記号・空白を除去する（数字は英数字として残る）', () => {
    expect(sanitizeNameForSpeech('ゆうき★')).toBe('ゆうき');
    expect(sanitizeNameForSpeech('たろう(2)')).toBe('たろう2');
    expect(sanitizeNameForSpeech('花 子')).toBe('花子');
  });

  it('絵文字（サロゲートペア）を除去する', () => {
    expect(sanitizeNameForSpeech('太郎🏸')).toBe('太郎');
    expect(sanitizeNameForSpeech('🏸')).toBe('');
  });

  it('記号のみの名前は空文字になる', () => {
    expect(sanitizeNameForSpeech('★★')).toBe('');
  });
});
