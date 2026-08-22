import { describe, it, expect } from 'vitest';
import {
  shouldCallNextMatch,
  maxPlayingElapsedMs,
  maxPlayingCourt,
  callBasisCourtId,
  buildNextMatchCallMessage,
  sanitizeNameForSpeech,
  shouldAnnounceToAdmin,
  adminAnnounceKey,
  buildAdminMatchCallMessage,
  canEvaluateMatchCall,
} from './nextMatchCall';
import {
  MATCH_CALL_THRESHOLD_MS,
  MATCH_CALL_COOLDOWN_MS,
  MATCH_CALL_ADMIN_THRESHOLD_MS,
  MATCH_CALL_RESUME_GUARD_MS,
} from './gameOperations';
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

describe('maxPlayingCourt', () => {
  it('プレイ中コートが無ければ null', () => {
    expect(maxPlayingCourt([emptyCourt(1)], NOW)).toBeNull();
  });

  it('複数のプレイ中コートのうち経過最大のコートを返す', () => {
    const c1 = playingCourt(1, NOW - 3 * 60 * 1000);
    const c2 = playingCourt(2, NOW - 7 * 60 * 1000);
    const courts = [c1, c2, emptyCourt(3)];
    expect(maxPlayingCourt(courts, NOW)).toEqual(c2);
  });

  it('経過時間が同着なら ID の小さい方を返す', () => {
    const c2 = playingCourt(2, NOW - 5 * 60 * 1000);
    const c1 = playingCourt(1, NOW - 5 * 60 * 1000);
    expect(maxPlayingCourt([c2, c1], NOW)).toEqual(c1);
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
  it('名前ありのとき body は改行区切り', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '花子']);
    expect(result.body).toBe('3コート付近で試合終了をお待ちください\n太郎さん・花子さん');
  });

  it('名前なしのとき body は見出しのみ', () => {
    const result = buildNextMatchCallMessage(3, []);
    expect(result.body).toBe('3コート付近で試合終了をお待ちください');
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
    // body には記号がそのまま残る（読み上げ専用の加工であることの確認）
    expect(result.body).toBe('3コート付近で試合終了をお待ちください\nゆうき★さん・たろう(2)さん');
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

  it('courtNumber が null のとき、名前ありで body・speech ともコート番号なしの見出しになる', () => {
    const result = buildNextMatchCallMessage(null, ['太郎', '花子']);
    expect(result.body).toBe('コート付近で試合終了をお待ちください\n太郎さん・花子さん');
    expect(result.speech).toBe('太郎さん、花子さん。コート付近で試合終了をお待ちください');
  });

  it('courtNumber が null のとき、名前なしで body・speech とも見出しのみになる', () => {
    const result = buildNextMatchCallMessage(null, []);
    expect(result.body).toBe('コート付近で試合終了をお待ちください');
    expect(result.speech).toBe('コート付近で試合終了をお待ちください');
  });

  it('courtNumber が null でも selfName の先頭寄せは従来どおり働く', () => {
    const result = buildNextMatchCallMessage(null, ['太郎', '花子', '次郎'], '花子');
    expect(result.speech).toBe('花子さん、太郎さん、次郎さん。コート付近で試合終了をお待ちください');
  });

  it('「外部」だけの名前は除去後に空文字になり読み上げ対象から外れる', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', '外部']);
    expect(result.speech).toBe('太郎さん。3コート付近で試合終了をお待ちください');
  });

  it('「外部」付きの selfName でも sanitize 後の比較で正しく先頭寄せされる', () => {
    const result = buildNextMatchCallMessage(3, ['太郎', 'たろう', '花子'], '外部たろう');
    expect(result.speech).toBe('たろうさん、太郎さん、花子さん。3コート付近で試合終了をお待ちください');
  });

  it('speech からは「外部」が消える一方、body には残る（読み上げ専用の加工であることの確認）', () => {
    const result = buildNextMatchCallMessage(3, ['外部たろう']);
    expect(result.speech).toBe('たろうさん。3コート付近で試合終了をお待ちください');
    expect(result.body).toBe('3コート付近で試合終了をお待ちください\n外部たろうさん');
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

  it('先頭の「外部」を除去する', () => {
    expect(sanitizeNameForSpeech('外部たろう')).toBe('たろう');
  });

  it('「外部 ゆうき」（半角空白入り）は空白除去後に接頭辞も除去される', () => {
    expect(sanitizeNameForSpeech('外部 ゆうき')).toBe('ゆうき');
  });

  it('「【外部】はなこ」は記号除去 → 接頭辞除去の順で「はなこ」になる', () => {
    expect(sanitizeNameForSpeech('【外部】はなこ')).toBe('はなこ');
  });

  it('名前の途中や末尾にある「外部」は除去されない', () => {
    expect(sanitizeNameForSpeech('たろう外部')).toBe('たろう外部');
  });
});

describe('adminAnnounceKey', () => {
  it('プレイ中コートが無ければ null', () => {
    expect(adminAnnounceKey([emptyCourt(1)], NOW)).toBeNull();
  });

  it('経過最大のプレイ中コートの id と startedAt からキーを組み立てる', () => {
    const startedAt = NOW - 7 * 60 * 1000;
    const courts = [playingCourt(1, NOW - 3 * 60 * 1000), playingCourt(2, startedAt)];
    expect(adminAnnounceKey(courts, NOW)).toBe(`2:${startedAt}`);
  });
});

describe('shouldAnnounceToAdmin', () => {
  const baseArgs = {
    courts: [playingCourt(1, NOW - MATCH_CALL_ADMIN_THRESHOLD_MS)],
    certainIds: new Set(['p5']),
    myPlayerId: 'me',
    now: NOW,
    isAdmin: true,
    announceEnabled: true,
    alreadyAnnouncedKey: null,
  };

  it('5分以上・条件を満たせば true', () => {
    expect(shouldAnnounceToAdmin(baseArgs)).toBe(true);
  });

  it('非管理者なら false', () => {
    const args = { ...baseArgs, isAdmin: false };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('端末設定 OFF なら false', () => {
    const args = { ...baseArgs, announceEnabled: false };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('5分未満なら false', () => {
    const args = {
      ...baseArgs,
      courts: [playingCourt(1, NOW - (MATCH_CALL_ADMIN_THRESHOLD_MS - 1))],
    };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('自分が対象メンバーに含まれていれば false', () => {
    const args = { ...baseArgs, certainIds: new Set(['me', 'p5']) };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('対象メンバーが全員どこかのコートに乗っていれば false', () => {
    const args = {
      ...baseArgs,
      certainIds: new Set(['p1']),
      courts: [playingCourt(1, NOW - MATCH_CALL_ADMIN_THRESHOLD_MS, ['p1', 'p2'], ['p3', 'p4'])],
    };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('対象メンバーのうち1人でも未着席なら true', () => {
    const args = {
      ...baseArgs,
      certainIds: new Set(['p1', 'p5']),
      courts: [playingCourt(1, NOW - MATCH_CALL_ADMIN_THRESHOLD_MS, ['p1', 'p2'], ['p3', 'p4'])],
    };
    expect(shouldAnnounceToAdmin(args)).toBe(true);
  });

  it('対象メンバーが0人なら false', () => {
    const args = { ...baseArgs, certainIds: new Set<string>() };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('同じキーで既にアナウンス済みなら false', () => {
    const key = adminAnnounceKey(baseArgs.courts, NOW);
    const args = { ...baseArgs, alreadyAnnouncedKey: key };
    expect(shouldAnnounceToAdmin(args)).toBe(false);
  });

  it('前回と異なるキーなら true（次の試合サイクルで解禁される）', () => {
    const args = { ...baseArgs, alreadyAnnouncedKey: '1:0' };
    expect(shouldAnnounceToAdmin(args)).toBe(true);
  });

  it('myPlayerId が null でも対象メンバーがいれば true', () => {
    const args = { ...baseArgs, myPlayerId: null };
    expect(shouldAnnounceToAdmin(args)).toBe(true);
  });
});

describe('buildAdminMatchCallMessage', () => {
  it('コート番号ありのとき指定の文言になる', () => {
    const result = buildAdminMatchCallMessage(3, ['太郎', '花子']);
    expect(result.speech).toBe('太郎さん、花子さん、もうすぐ3コートで試合です');
  });

  it('コート番号なしのとき指定の文言になる', () => {
    const result = buildAdminMatchCallMessage(null, ['太郎', '花子']);
    expect(result.speech).toBe('太郎さん、花子さん、もうすぐ試合です');
  });

  it('記号・絵文字は読み上げから除去される', () => {
    const result = buildAdminMatchCallMessage(3, ['ゆうき★', '太郎🏸']);
    expect(result.speech).toBe('ゆうきさん、太郎さん、もうすぐ3コートで試合です');
  });

  it('「外部」接頭辞は読み上げから除去される', () => {
    const result = buildAdminMatchCallMessage(3, ['外部たろう', '花子']);
    expect(result.speech).toBe('たろうさん、花子さん、もうすぐ3コートで試合です');
  });
});

describe('canEvaluateMatchCall', () => {
  const NOW = 1_000_000;

  it('受信済み・復帰イベント無しなら判定してよい', () => {
    expect(
      canEvaluateMatchCall({ now: NOW, gameStateLoaded: true, becameVisibleAt: null }),
    ).toBe(true);
  });

  it('gameState 未受信（再購読中・同期エラー中）なら判定しない', () => {
    expect(
      canEvaluateMatchCall({ now: NOW, gameStateLoaded: false, becameVisibleAt: null }),
    ).toBe(false);
  });

  it('visible 復帰から猶予内なら判定しない（古い courts で鳴るのを防ぐ）', () => {
    expect(
      canEvaluateMatchCall({
        now: NOW,
        gameStateLoaded: true,
        becameVisibleAt: NOW - (MATCH_CALL_RESUME_GUARD_MS - 1),
      }),
    ).toBe(false);
  });

  it('visible 復帰から猶予を過ぎれば判定してよい', () => {
    expect(
      canEvaluateMatchCall({
        now: NOW,
        gameStateLoaded: true,
        becameVisibleAt: NOW - MATCH_CALL_RESUME_GUARD_MS,
      }),
    ).toBe(true);
  });

  it('猶予を過ぎていても未受信なら判定しない', () => {
    expect(
      canEvaluateMatchCall({
        now: NOW,
        gameStateLoaded: false,
        becameVisibleAt: NOW - MATCH_CALL_RESUME_GUARD_MS * 10,
      }),
    ).toBe(false);
  });
});
