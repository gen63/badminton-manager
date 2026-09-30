import { describe, it, expect } from 'vitest';
import {
  buildFinishOperationGuide,
  buildFinishOperationGuideHeadline,
  getNextFinishGuideDelay,
  canFinishGame,
  standbyCourtIds,
  STANDBY_CLOSE_START_MS,
  buildFinishBlockedMessage,
  buildFinishConfirmMessage,
  isOperatorExcluded,
  filterOperatorIds,
  selectOperatorIds,
  finishAllowedIds,
  type FinishOperationGuide,
} from './finishOperationGuide';
import { defaultExcludeFromOperator } from './operatorExclusion';
import { MATCH_CALL_THRESHOLD_MS } from './gameOperations';
import type { Court } from '../types/court';
import type { Player } from '../types/player';
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

/** 経過 `elapsed` ms のコートになる開始時刻 */
const startedAtForElapsed = (elapsed: number) => NOW - elapsed;

describe('standbyCourtIds', () => {
  it('プレイ中コートが無ければ空', () => {
    expect(standbyCourtIds([emptyCourt(1), emptyCourt(2)], NOW)).toEqual([]);
  });

  it('startedAt が 0 のコートは対象外', () => {
    expect(standbyCourtIds([{ ...playingCourt(1, 0), isPlaying: true }], NOW)).toEqual([]);
  });

  it('経過が離れていれば最も早く終わりそうな1面だけ', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(60_000)),
      playingCourt(2, startedAtForElapsed(200_000)),
      playingCourt(3, startedAtForElapsed(10_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([2]);
  });

  it('差が60秒ちょうどなら近接扱いで2面とも返す（id 昇順）', () => {
    const courts = [
      playingCourt(2, startedAtForElapsed(200_000 - STANDBY_CLOSE_START_MS)),
      playingCourt(1, startedAtForElapsed(200_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1, 2]);
  });

  it('差が60秒を1ms でも超えれば絞り込む', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(200_000)),
      playingCourt(2, startedAtForElapsed(200_000 - STANDBY_CLOSE_START_MS - 1)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1]);
  });

  it('近接コートが3面以上なら場所を絞れないので空（3面同時開始）', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      playingCourt(2, startedAtForElapsed(120_000)),
      playingCourt(3, startedAtForElapsed(120_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([]);
  });

  it('3面のうち隣接する2面だけ近接なら、その2面を返す', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      playingCourt(2, startedAtForElapsed(90_000)),
      playingCourt(3, startedAtForElapsed(10_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([1, 2]);
  });

  it('近接2面が隣り合っていなければ番号を出さない（①と③）', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      playingCourt(2, startedAtForElapsed(10_000)),
      playingCourt(3, startedAtForElapsed(90_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([]);
  });

  it('間のコートが試合中でなくても、飛んだ番号なら出さない', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(120_000)),
      emptyCourt(2),
      playingCourt(3, startedAtForElapsed(90_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([]);
  });

  it('隣接していれば先頭以外の組でも返す（②③）', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(10_000)),
      playingCourt(2, startedAtForElapsed(120_000)),
      playingCourt(3, startedAtForElapsed(90_000)),
    ];
    expect(standbyCourtIds(courts, NOW)).toEqual([2, 3]);
  });
});

describe('buildFinishOperationGuide', () => {
  const args = (over: Partial<Parameters<typeof buildFinishOperationGuide>[0]> = {}) => ({
    courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
    certainIds: new Set(['w1', 'w2']),
    now: NOW,
    showCourtNumber: true,
    ...over,
  });

  it('プレイ中コートが無ければ null', () => {
    expect(buildFinishOperationGuide(args({ courts: [emptyCourt(1), emptyCourt(2)] }))).toBeNull();
  });

  it('startedAt が 0 のコートはプレイ中とみなさない', () => {
    const notStarted = { ...playingCourt(1, 0), isPlaying: true };
    expect(buildFinishOperationGuide(args({ courts: [notStarted] }))).toBeNull();
  });

  it('4:30 未満でも出す（段階は waiting）', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 1))] }),
    );
    expect(guide?.phase).toBe('waiting');
    expect(guide?.courtIds).toEqual([1]);
  });

  it('試合開始直後でも待機場所を出す', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(3, startedAtForElapsed(1_000))] }),
    );
    expect(guide?.phase).toBe('waiting');
    expect(guide?.courtIds).toEqual([3]);
  });

  it('4:30 ちょうどで imminent になる', () => {
    const guide = buildFinishOperationGuide(
      args({ courts: [playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))] }),
    );
    expect(guide?.phase).toBe('imminent');
    expect(guide?.courtIds).toEqual([2]);
    expect(guide?.playerIds).toEqual(['w1', 'w2']);
  });

  it('certainIds が空なら null', () => {
    expect(buildFinishOperationGuide(args({ certainIds: new Set() }))).toBeNull();
  });

  it('対象が全員コートに乗っていれば null', () => {
    // p1〜p4 は playingCourt のデフォルトメンバー
    expect(buildFinishOperationGuide(args({ certainIds: new Set(['p1', 'p3']) }))).toBeNull();
  });

  it('コートに乗っている人を除いた残りが担当になる', () => {
    const guide = buildFinishOperationGuide(args({ certainIds: new Set(['p1', 'w1']) }));
    expect(guide?.playerIds).toEqual(['w1']);
  });

  it('複数コートがプレイ中で経過が離れていれば最大のコートを指す', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS + 120_000)),
          playingCourt(3, startedAtForElapsed(10_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide?.courtIds).toEqual([2]);
  });

  it('開始が近い2面は両方を指す', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 30_000)),
          playingCourt(3, startedAtForElapsed(10_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide?.courtIds).toEqual([1, 2]);
  });

  it('近接2面が隣り合っていなければ番号を出さない', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(10_000)),
          playingCourt(
            3,
            startedAtForElapsed(MATCH_CALL_THRESHOLD_MS - 30_000),
            ['b1', 'b2'],
            ['b3', 'b4'],
          ),
        ],
      }),
    );
    expect(guide).not.toBeNull();
    expect(guide?.courtIds).toEqual([]);
  });

  it('3面同時開始なら番号を出さない', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [
          playingCourt(1, startedAtForElapsed(120_000), ['a1', 'a2'], ['a3', 'a4']),
          playingCourt(2, startedAtForElapsed(120_000)),
          playingCourt(3, startedAtForElapsed(120_000), ['b1', 'b2'], ['b3', 'b4']),
        ],
      }),
    );
    expect(guide).not.toBeNull();
    expect(guide?.courtIds).toEqual([]);
  });

  it('空きコートがあってもプレイ中コートを指す（callBasisCourtId との差分）', () => {
    const guide = buildFinishOperationGuide(
      args({
        courts: [emptyCourt(1), playingCourt(2, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
      }),
    );
    expect(guide?.courtIds).toEqual([2]);
  });

  it('showCourtNumber が false なら courtIds は空', () => {
    const guide = buildFinishOperationGuide(args({ showCourtNumber: false }));
    expect(guide).not.toBeNull();
    expect(guide?.courtIds).toEqual([]);
  });
});

describe('buildFinishOperationGuideHeadline', () => {
  const guideWith = (courtIds: number[]): FinishOperationGuide => ({
    phase: 'imminent',
    courtIds,
    playerIds: ['w1'],
  });

  it('コート番号は丸数字（コートカードの丸バッジと揃える）', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([1]))).toBe('①付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([2]))).toBe('②付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([3]))).toBe('③付近待機');
  });

  it('近接2面は区切り無しで並べる', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([1, 2]))).toBe('①②付近待機');
    expect(buildFinishOperationGuideHeadline(guideWith([3, 4]))).toBe('③④付近待機');
  });

  it('丸数字が無い範囲は素の数字＋コートに戻す', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([21]))).toBe('21コート付近待機');
  });

  it('コート番号が無ければ番号を省く（1面運用・3面同時開始）', () => {
    expect(buildFinishOperationGuideHeadline(guideWith([]))).toBe('コート付近待機');
  });
});

describe('getNextFinishGuideDelay', () => {
  it('プレイ中コートが無ければ null', () => {
    expect(getNextFinishGuideDelay([emptyCourt(1)], NOW)).toBeNull();
  });

  it('4:30 までの残り時間を返す', () => {
    const courts = [playingCourt(1, startedAtForElapsed(60_000))];
    expect(getNextFinishGuideDelay(courts, NOW)).toBe(MATCH_CALL_THRESHOLD_MS - 60_000);
  });

  it('既に 4:30 を超えていれば null', () => {
    const courts = [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))];
    expect(getNextFinishGuideDelay(courts, NOW)).toBeNull();
  });

  it('経過最大のコート基準で残りを返す', () => {
    const courts = [
      playingCourt(1, startedAtForElapsed(10_000)),
      playingCourt(2, startedAtForElapsed(120_000)),
    ];
    expect(getNextFinishGuideDelay(courts, NOW)).toBe(MATCH_CALL_THRESHOLD_MS - 120_000);
  });
});

describe('canFinishGame', () => {
  it('管理者（作成者 / 管理権限 / 開発モード）は常に押せる', () => {
    expect(
      canFinishGame({ isAdmin: true, certainIds: new Set(['a']), myPlayerId: 'b' }),
    ).toBe(true);
  });

  it('操作担当（ほぼ確定メンバー）は押せる', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a', 'b']), myPlayerId: 'b' }),
    ).toBe(true);
  });

  it('担当が居るのに自分が担当でなければ押せない', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a']), myPlayerId: 'b' }),
    ).toBe(false);
  });

  it('担当が居て自分の Player を特定できなければ押せない', () => {
    expect(
      canFinishGame({ isAdmin: false, certainIds: new Set(['a']), myPlayerId: null }),
    ).toBe(false);
  });

  it('担当が 1 人も居なければ全員押せる（フォールバック）', () => {
    expect(canFinishGame({ isAdmin: false, certainIds: new Set(), myPlayerId: 'b' })).toBe(true);
  });

  it('担当が居らず自分の Player を特定できなくても押せる（フォールバック）', () => {
    expect(canFinishGame({ isAdmin: false, certainIds: new Set(), myPlayerId: null })).toBe(true);
  });
});

describe('buildFinishBlockedMessage', () => {
  it('担当 1 人ならその人を名指しする', () => {
    expect(buildFinishBlockedMessage(['太郎'])).toBe('濃い青の太郎さんが担当です。押せません');
  });

  it('担当が複数なら渡された順に中黒で並べる', () => {
    expect(buildFinishBlockedMessage(['太郎', '花子'])).toBe(
      '濃い青の太郎さん・花子さんが担当です。押せません',
    );
  });

  it('担当が居なければ管理者運用の説明を返す（保険）', () => {
    expect(buildFinishBlockedMessage([])).toBe('終了操作は管理者と操作担当のみできます');
  });
});

describe('buildFinishConfirmMessage', () => {
  const base = {
    courtId: 2,
    elapsedMs: 133_000,
    teamANames: ['太郎', '花子'],
    teamBNames: ['一郎', '幸子'],
  };

  it('コート・経過時間・出場者を並べる', () => {
    expect(buildFinishConfirmMessage(base)).toBe(
      '② 経過 2:13\n太郎・花子 vs 一郎・幸子\n\n始まったばかりの試合です。他の人が終了した直後に始まった試合ではありませんか？',
    );
  });

  it('1面運用（courtId が null）ならコート番号を出さない', () => {
    expect(buildFinishConfirmMessage({ ...base, courtId: null })).toContain('経過 2:13\n太郎');
    expect(buildFinishConfirmMessage({ ...base, courtId: null })).not.toContain('②');
  });

  it('経過は m:ss（秒は2桁ゼロ埋め）', () => {
    expect(buildFinishConfirmMessage({ ...base, elapsedMs: 65_000 })).toContain('経過 1:05');
    expect(buildFinishConfirmMessage({ ...base, elapsedMs: 0 })).toContain('経過 0:00');
  });

  it('シングルスなど人数が違っても並べられる', () => {
    expect(
      buildFinishConfirmMessage({ ...base, teamANames: ['太郎'], teamBNames: ['一郎'] }),
    ).toContain('太郎 vs 一郎');
  });
});

const mkPlayer = (id: string, name: string, over: Partial<Player> = {}): Player => ({
  id,
  name,
  isResting: false,
  gamesPlayed: 0,
  lastPlayedAt: 0,
  activatedAt: 0,
  ...over,
});

describe('isOperatorExcluded / filterOperatorIds', () => {
  it('名前に「外部」を含んでいてもフラグが無ければ担当になれる', () => {
    expect(isOperatorExcluded(mkPlayer('a', '外部はなこ'))).toBe(false);
    expect(isOperatorExcluded(mkPlayer('a', '【外部】はなこ', { excludeFromOperator: false }))).toBe(false);
  });

  it('通常の人は担当外ではない', () => {
    expect(isOperatorExcluded(mkPlayer('a', '太郎'))).toBe(false);
    expect(isOperatorExcluded(mkPlayer('a', '太郎', { excludeFromOperator: false }))).toBe(false);
  });

  it('excludeFromOperator が true なら担当外', () => {
    expect(isOperatorExcluded(mkPlayer('a', '太郎', { excludeFromOperator: true }))).toBe(true);
  });

  it('filterOperatorIds は担当外を除く（players に居ない ID は残す）', () => {
    const players = [
      mkPlayer('a', '太郎'),
      mkPlayer('b', '外部はなこ'),
      mkPlayer('c', '次郎', { excludeFromOperator: true }),
    ];
    const result = filterOperatorIds(new Set(['a', 'b', 'c', 'zzz']), players);
    expect([...result].sort()).toEqual(['a', 'b', 'zzz']);
  });
});

describe('担当外を除いた担当での判定', () => {
  const players = [mkPlayer('ext', '外部はなこ', { excludeFromOperator: true }), mkPlayer('me', '自分')];

  it('確定が担当外のみなら担当が空になり、canFinishGame は全員に開放される', () => {
    const operatorIds = filterOperatorIds(new Set(['ext']), players);
    expect(operatorIds.size).toBe(0);
    expect(canFinishGame({ isAdmin: false, certainIds: operatorIds, myPlayerId: 'me' })).toBe(true);
  });

  it('担当外と通常メンバーが確定なら、通常メンバーだけが終了できる', () => {
    const operatorIds = filterOperatorIds(new Set(['ext', 'me']), players);
    expect(canFinishGame({ isAdmin: false, certainIds: operatorIds, myPlayerId: 'ext' })).toBe(false);
    expect(canFinishGame({ isAdmin: false, certainIds: operatorIds, myPlayerId: 'me' })).toBe(true);
  });

  it('buildFinishOperationGuide の待機メンバーに担当外が含まれない', () => {
    const guide = buildFinishOperationGuide({
      courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
      certainIds: filterOperatorIds(new Set(['ext', 'me']), players),
      now: NOW,
      showCourtNumber: true,
    });
    expect(guide?.playerIds).toEqual(['me']);
  });

  it('確定が担当外のみならガイドは出ない', () => {
    const guide = buildFinishOperationGuide({
      courts: [playingCourt(1, startedAtForElapsed(MATCH_CALL_THRESHOLD_MS))],
      certainIds: filterOperatorIds(new Set(['ext']), players),
      now: NOW,
      showCourtNumber: true,
    });
    expect(guide).toBeNull();
  });
});

describe('defaultExcludeFromOperator', () => {
  it('名前に「外部」を含めば true（接頭辞・括弧付きも含む）', () => {
    expect(defaultExcludeFromOperator('外部はなこ')).toBe(true);
    expect(defaultExcludeFromOperator('【外部】はなこ')).toBe(true);
    expect(defaultExcludeFromOperator('太郎（外部）')).toBe(true);
  });

  it('含まなければ undefined（担当）', () => {
    expect(defaultExcludeFromOperator('太郎')).toBeUndefined();
  });
});

describe('selectOperatorIds（担当の繰り上げ）', () => {
  const players = [
    mkPlayer('a', '太郎'),
    mkPlayer('b', '次郎'),
    mkPlayer('c', '三郎'),
    mkPlayer('ext', '外部はなこ', { excludeFromOperator: true }),
  ];
  const pred = (certain: string[], likely: string[], rates: Record<string, number>) => ({
    certainIds: new Set(certain),
    likelyIds: new Set(likely),
    appearanceRate: new Map(Object.entries(rates)),
  });

  it('担当外を除いた確定者が居れば従来どおり（繰り上げない）', () => {
    const r = selectOperatorIds(pred(['a', 'ext'], ['b'], { a: 1, ext: 1, b: 0.6 }), players);
    expect([...r]).toEqual(['a']);
  });

  it('確定が居なければ最高出現率の人を繰り上げる', () => {
    const r = selectOperatorIds(pred([], ['a', 'b'], { a: 0.67, b: 0.33 }), players);
    expect([...r]).toEqual(['a']);
  });

  it('最高出現率が同率なら全員を繰り上げる', () => {
    const r = selectOperatorIds(pred([], ['a', 'b', 'c'], { a: 0.5, b: 0.5, c: 0.25 }), players);
    expect([...r].sort()).toEqual(['a', 'b']);
  });

  it('確定が全員担当外なら候補から繰り上げる', () => {
    const r = selectOperatorIds(pred(['ext'], ['b', 'c'], { ext: 1, b: 0.6, c: 0.4 }), players);
    expect([...r]).toEqual(['b']);
  });

  it('担当外は繰り上げ対象にならず、次点の人が担当になる', () => {
    const r = selectOperatorIds(pred([], ['ext', 'c'], { ext: 0.8, c: 0.3 }), players);
    expect([...r]).toEqual(['c']);
  });

  it('繰り上げ候補も全員担当外なら空（canFinishGame の全員開放が保険）', () => {
    const r = selectOperatorIds(pred(['ext'], [], { ext: 1 }), players);
    expect(r.size).toBe(0);
    expect(canFinishGame({ isAdmin: false, certainIds: r, myPlayerId: 'a' })).toBe(true);
  });

  it('予測が空なら空', () => {
    expect(selectOperatorIds(pred([], [], {}), players).size).toBe(0);
  });

  it('予測バーに出ない人（確定でも候補でもない）は繰り上げない', () => {
    const r = selectOperatorIds(pred([], ['a'], { a: 0.3, b: 0.2 }), players);
    expect([...r]).toEqual(['a']);
  });

  it('players に居ない ID は担当外判定できないので除外しない', () => {
    const r = selectOperatorIds(pred([], ['zzz', 'a'], { zzz: 0.9, a: 0.5 }), players);
    expect([...r]).toEqual(['zzz']);
  });
});

describe('finishAllowedIds（終了ボタン権）', () => {
  it('操作担当とほぼ確定の和集合', () => {
    const operators = new Set(['a', 'b']);
    const certain = new Set(['b', 'c']);
    const allowed = finishAllowedIds(operators, certain);
    expect([...allowed].sort()).toEqual(['a', 'b', 'c']);
  });

  it('操作担当が空なら空（canFinishGame の全員開放に委ねる）', () => {
    const allowed = finishAllowedIds(new Set(), new Set(['a', 'b']));
    expect(allowed.size).toBe(0);
    expect(canFinishGame({ isAdmin: false, certainIds: allowed, myPlayerId: 'z' })).toBe(true);
  });

  it('確定が空なら操作担当だけ', () => {
    const allowed = finishAllowedIds(new Set(['a', 'b']), new Set());
    expect([...allowed].sort()).toEqual(['a', 'b']);
  });

  it('担当外だが確定の人が canFinishGame で true', () => {
    const players = [mkPlayer('ext', '外部はなこ', { excludeFromOperator: true }), mkPlayer('me', '自分')];
    const operatorIds = selectOperatorIds(
      {
        certainIds: new Set(['ext']),
        likelyIds: new Set(),
        appearanceRate: new Map([['ext', 1]]),
      },
      players,
    );
    // operatorIds は空（ext が担当外なので除外される）
    expect(operatorIds.size).toBe(0);
    // finishAllowedIds で確定を加える
    const allowed = finishAllowedIds(operatorIds, new Set(['ext']));
    // ext は確定なので終了できる
    expect(canFinishGame({ isAdmin: false, certainIds: allowed, myPlayerId: 'ext' })).toBe(true);
  });

  it('確定でも担当でもない人は canFinishGame で false', () => {
    const operators = new Set(['a']);
    const certain = new Set(['a']);
    const allowed = finishAllowedIds(operators, certain);
    expect(canFinishGame({ isAdmin: false, certainIds: allowed, myPlayerId: 'b' })).toBe(false);
  });
});
