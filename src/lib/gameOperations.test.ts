import { describe, it, expect } from 'vitest';
import { computeFinishAndContinue, gameModeFromPracticeType, type GameState } from './gameOperations';
import type { Player } from '../types/player';
import type { Court } from '../types/court';

/** テスト用プレイヤー生成 */
function makePlayer(id: string, overrides?: Partial<Player>): Player {
  return {
    id,
    name: `Player ${id}`,
    isResting: false,
    gamesPlayed: 0,
    lastPlayedAt: 0,
    activatedAt: Date.now() - 60000,
    ...overrides,
  };
}

/** テスト用コート生成 */
function makeCourt(id: number, overrides?: Partial<Court>): Court {
  return {
    id,
    teamA: ['', ''],
    teamB: ['', ''],
    scoreA: 0,
    scoreB: 0,
    isPlaying: false,
    startedAt: 0,
    finishedAt: 0,
    ...overrides,
  };
}

/** 基本的なゲーム状態（コート1で試合中、待機プレイヤー十分） */
function makeBaseState(): GameState {
  return {
    players: [
      // コート上のプレイヤー
      makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4'),
      // 待機プレイヤー（連続モード用に7人以上）
      makePlayer('p5'), makePlayer('p6'), makePlayer('p7'), makePlayer('p8'),
      makePlayer('p9'), makePlayer('p10'), makePlayer('p11'), makePlayer('p12'),
    ],
    courts: [
      makeCourt(1, {
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        isPlaying: true,
        startedAt: 1710500000000,
      }),
    ],
    matchHistory: [],
    reservations: [],
  };
}

const defaultOptions = {
  continuousMatchMode: false,
  useStayDurationPriority: true,
  prioritizeDiversity: false,
  gameMode: 'doubles' as const,
};

describe('computeFinishAndContinue', () => {
  describe('試合終了（連続モードOFF）', () => {
    it('試合記録がmatchHistoryに追加される', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      expect(result.newState.matchHistory).toHaveLength(1);
      const match = result.newState.matchHistory[0];
      expect(match.courtId).toBe(1);
      expect(match.teamA).toEqual(['p1', 'p2']);
      expect(match.teamB).toEqual(['p3', 'p4']);
      expect(match.startedAt).toBe(1710500000000);
      expect(match.finishedAt).toBeGreaterThan(0);
    });

    it('コート上のプレイヤーのgamesPlayedが+1される', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      const updatedPlayers = result.newState.players;
      expect(updatedPlayers.find(p => p.id === 'p1')?.gamesPlayed).toBe(1);
      expect(updatedPlayers.find(p => p.id === 'p2')?.gamesPlayed).toBe(1);
      expect(updatedPlayers.find(p => p.id === 'p3')?.gamesPlayed).toBe(1);
      expect(updatedPlayers.find(p => p.id === 'p4')?.gamesPlayed).toBe(1);
      // 待機プレイヤーは変化なし
      expect(updatedPlayers.find(p => p.id === 'p5')?.gamesPlayed).toBe(0);
    });

    it('コートがクリアされる', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      const court = result.newState.courts[0];
      expect(court.isPlaying).toBe(false);
      expect(court.teamA).toEqual(['', '']);
      expect(court.teamB).toEqual(['', '']);
      expect(court.startedAt).toBe(0);
    });

    it('continuousNextApplied が false', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.continuousNextApplied).toBe(false);
    });
  });

  describe('コートが試合中でない場合', () => {
    it('何も変更しない', () => {
      const state = makeBaseState();
      state.courts[0].isPlaying = false;

      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.newState).toBe(state); // 参照が同じ
      expect(result.continuousNextApplied).toBe(false);
    });

    it('存在しないコートIDで何も変更しない', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 99, defaultOptions);
      expect(result.newState).toBe(state);
    });
  });

  describe('試合後の休憩判定（統一ルール）', () => {
    it('未成立予約を持つメンバーは試合後に休憩へ戻る', () => {
      const state = makeBaseState();
      // p1 は別の未成立予約を持つ（試合後は休憩で次の予約待ち）
      state.reservations = [
        { id: 'r1', orderNumber: 1, playerIds: ['p1', 'p9'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ];
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.newState.players.find(p => p.id === 'p1')?.isResting).toBe(true);
    });

    it('予約を持たないメンバーは試合後に待機（active）に戻る', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      // p1-p4 はコート上で試合 → 終了後は待機
      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        expect(result.newState.players.find(p => p.id === id)?.isResting).toBe(false);
      }
    });

    it('休憩からタップ交換で出場したメンバー（restingPlayerIds）は試合後に休憩へ戻る', () => {
      const state = makeBaseState();
      // p1 は休憩からタップ交換で出場した（swapPlayer が restingPlayerIds に積む）
      state.courts[0].restingPlayerIds = ['p1'];
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      expect(result.newState.players.find(p => p.id === 'p1')?.isResting).toBe(true);
      // 他のメンバーは待機へ
      for (const id of ['p2', 'p3', 'p4']) {
        expect(result.newState.players.find(p => p.id === id)?.isResting).toBe(false);
      }
      // コートクリアでフラグも消える
      expect(result.newState.courts[0].restingPlayerIds).toEqual([]);
    });

    it('未成立予約のメンバー全員が出場していた試合の終了で予約を消化し、待機へ戻す', () => {
      const state = makeBaseState();
      // p1 と p2 の予約をタップ交換などで手動配置して試合した想定
      state.reservations = [
        { id: 'r1', orderNumber: 1, playerIds: ['p1', 'p2'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ];
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      const r1 = result.newState.reservations.find(r => r.id === 'r1');
      expect(r1?.status).toBe('fulfilled');
      expect(r1?.fulfilledAt).toBeGreaterThan(0);
      // 予約は消化されたので休憩ではなく待機へ
      expect(result.newState.players.find(p => p.id === 'p1')?.isResting).toBe(false);
      expect(result.newState.players.find(p => p.id === 'p2')?.isResting).toBe(false);
    });

    it('メンバーの一部しか出場していない未成立予約は消化せず、出場者を休憩へ戻す', () => {
      const state = makeBaseState();
      // p1 は待機中の p9 との予約を持つ（p9 は出場していない）
      state.reservations = [
        { id: 'r1', orderNumber: 1, playerIds: ['p1', 'p9'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
      ];
      const result = computeFinishAndContinue(state, 1, defaultOptions);

      expect(result.newState.reservations.find(r => r.id === 'r1')?.status).toBe('pending');
      expect(result.newState.players.find(p => p.id === 'p1')?.isResting).toBe(true);
    });
  });

  describe('連続モード', () => {
    const continuousOptions = { ...defaultOptions, continuousMatchMode: true };

    it('待機プレイヤーが十分な場合、次の配置が行われる', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, continuousOptions);

      expect(result.continuousNextApplied).toBe(true);
      const court = result.newState.courts[0];
      expect(court.isPlaying).toBe(true);
      expect(court.startedAt).toBeGreaterThan(0);
      // 新しいプレイヤーが配置されている
      expect(court.teamA[0]).not.toBe('');
      expect(court.teamB[0]).not.toBe('');
      // 元のプレイヤーは含まれない（gamesPlayed+1で優先度が下がる）
    });

    it('skipContinuous=true なら連続モードでも次の配置をしない（自動終了用）', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, {
        ...continuousOptions,
        skipContinuous: true,
      });

      // 次の試合は配置されず、コートはクリアされたまま
      expect(result.continuousNextApplied).toBe(false);
      expect(result.continuousError).toBeUndefined();
      const court = result.newState.courts[0];
      expect(court.isPlaying).toBe(false);
      expect(court.teamA[0]).toBe('');
      // 試合は終了記録される
      expect(result.newState.matchHistory.length).toBe(state.matchHistory.length + 1);
      // 連続モード設定自体は変更しない
      expect(result.newState.settings).toBe(state.settings);
    });

    it('待機プレイヤーが不足の場合、配置されない', () => {
      const state = makeBaseState();
      // 待機プレイヤーを6人に減らす（最低7人必要）
      state.players = state.players.slice(0, 10);
      // p1-p4がコートから出て待機に入っても合計10人-他コート0人=10人待機
      // だが、finishでp1-p4がgamesPlayed更新されて待機リストに入る前に
      // waitingPlayersは courts上にいないプレイヤーで計算される
      // 12人→10人に減らしてもまだ足りる。もっと減らす
      state.players = state.players.slice(0, 8); // p1-p4 + p5-p8 = 8人
      // finish後: p1-p4が待機に、p5-p8も待機 = 8人待機、7人以上なので足りる

      // 完全に不足にするには
      state.players = state.players.slice(0, 5); // p1-p4 + p5 = 5人
      // finish後: 全5人が待機 → 5人 < 7人 → 不足

      const result = computeFinishAndContinue(state, 1, continuousOptions);
      expect(result.continuousNextApplied).toBe(false);
      expect(result.continuousError).toBe('not_enough_players');
      // コートはクリアされたまま
      expect(result.newState.courts[0].isPlaying).toBe(false);
    });

    it('diversity block が発動する場合', () => {
      const state = makeBaseState();
      // 2コートにし、コート2も試合中にする
      state.courts.push(makeCourt(2, {
        teamA: ['p5', 'p6'],
        teamB: ['p7', 'p8'],
        isPlaying: true,
        startedAt: 1710500000000,
      }));
      // p9-p12 の4人だけ待機 → occupiedが1コート(コート2) × 4 = 4人使用中
      // active = 12人、actualWaiting = 12 - 1*4 = 8 → threshold(7)以上 → ブロックされない
      // もっと人数を減らす
      state.players = state.players.slice(0, 10); // 10人
      // finish court 1 → p1-p4が待機に、court2のp5-p8がプレイ中
      // active=10, occupied=1(court2), actualWaiting=10-1*4=6 < 7 → ブロック

      const result = computeFinishAndContinue(state, 1, {
        ...continuousOptions,
        prioritizeDiversity: true,
      });
      expect(result.continuousNextApplied).toBe(false);
      expect(result.continuousError).toBe('diversity_block');
    });

    it('diversity block 発動時も settings.continuousMatchMode は OFF にしない（その回の自動配置のみ見送る）', () => {
      const state: GameState = {
        ...makeBaseState(),
        settings: {
          recordScores: true,
          continuousMatchMode: true,
          practiceType: '楽',
        },
      };
      state.courts.push(makeCourt(2, {
        teamA: ['p5', 'p6'],
        teamB: ['p7', 'p8'],
        isPlaying: true,
        startedAt: 1710500000000,
      }));
      state.players = state.players.slice(0, 10);

      const result = computeFinishAndContinue(state, 1, {
        ...continuousOptions,
        prioritizeDiversity: true,
      });

      expect(result.continuousError).toBe('diversity_block');
      // 連続モード自体は維持し、待機人数が回復したら自動再開できるようにする
      expect(result.newState.settings?.continuousMatchMode).toBe(true);
      expect(result.newState.settings?.recordScores).toBe(true);
      expect(result.newState.settings?.practiceType).toBe('楽');
    });

    it('2コート10人+成立可能な4人予約: 待機6人でも予約でゲートを通過し、終了コートに予約を配置する', () => {
      // 2コート10人。r1-r4 は4人予約で休憩中、w1-w4 がコート1で試合中、
      // w5, w6 が待機。コート1終了後は待機6人（w1-w6）+ 呼び出し可能4人 = 10 >= 7。
      // 従来は待機6人 < 7 で not_enough_players となり配置されなかった。
      const state: GameState = {
        players: [
          makePlayer('w1'), makePlayer('w2'), makePlayer('w3'), makePlayer('w4'),
          makePlayer('w5'), makePlayer('w6'),
          makePlayer('r1', { isResting: true }), makePlayer('r2', { isResting: true }),
          makePlayer('r3', { isResting: true }), makePlayer('r4', { isResting: true }),
        ],
        courts: [
          makeCourt(1, {
            teamA: ['w1', 'w2'],
            teamB: ['w3', 'w4'],
            isPlaying: true,
            startedAt: 1710500000000,
          }),
          makeCourt(2),
        ],
        matchHistory: [],
        reservations: [
          { id: 'rsv1', orderNumber: 1, playerIds: ['r1', 'r2', 'r3', 'r4'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
        ],
      };

      const result = computeFinishAndContinue(state, 1, continuousOptions);

      expect(result.continuousError).toBeUndefined();
      expect(result.continuousNextApplied).toBe(true);
      const court = result.newState.courts[0];
      expect(new Set([...court.teamA, ...court.teamB]))
        .toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
      // 予約メンバーは休憩解除され、予約は消化される
      for (const id of ['r1', 'r2', 'r3', 'r4']) {
        expect(result.newState.players.find(p => p.id === id)?.isResting).toBe(false);
      }
      expect(result.newState.reservations[0].status).toBe('fulfilled');
    });

    it('予約メンバーが試合中で成立不可なら、従来どおり not_enough_players で見送る', () => {
      // r4 がコート2で試合中 → 予約は成立不可 → callable 0 → 待機4人 < 7
      const state: GameState = {
        players: [
          makePlayer('w1'), makePlayer('w2'), makePlayer('w3'), makePlayer('w4'),
          makePlayer('w5'), makePlayer('w6'),
          makePlayer('r1', { isResting: true }), makePlayer('r2', { isResting: true }),
          makePlayer('r3', { isResting: true }), makePlayer('r4'),
        ],
        courts: [
          makeCourt(1, {
            teamA: ['w1', 'w2'],
            teamB: ['w3', 'w4'],
            isPlaying: true,
            startedAt: 1710500000000,
          }),
          makeCourt(2, {
            teamA: ['r4', 'w5'],
            teamB: ['w6', 'w6b'],
            isPlaying: true,
            startedAt: 1710500000000,
          }),
        ],
        matchHistory: [],
        reservations: [
          { id: 'rsv1', orderNumber: 1, playerIds: ['r1', 'r2', 'r3', 'r4'], status: 'pending', createdAt: 0, fulfilledAt: 0 },
        ],
      };
      state.players.push(makePlayer('w6b'));

      const result = computeFinishAndContinue(state, 1, continuousOptions);
      expect(result.continuousNextApplied).toBe(false);
      expect(result.continuousError).toBe('not_enough_players');
    });

    it('not_enough_players では continuousMatchMode を OFF にしない', () => {
      const state: GameState = {
        players: [
          makePlayer('p1'), makePlayer('p2'),
          makePlayer('p3'), makePlayer('p4'),
          makePlayer('p5'),
        ],
        courts: [
          makeCourt(1, {
            teamA: ['p1', 'p2'],
            teamB: ['p3', 'p4'],
            isPlaying: true,
            startedAt: 1710500000000,
          }),
        ],
        matchHistory: [],
        reservations: [],
        settings: {
          recordScores: true,
          continuousMatchMode: true,
          practiceType: '複',
        },
      };

      const result = computeFinishAndContinue(state, 1, continuousOptions);
      expect(result.continuousError).toBe('not_enough_players');
      // not_enough_players は単に人数が足りないだけで連続モード自体は無効化しない
      expect(result.newState.settings?.continuousMatchMode).toBe(true);
    });
  });

  describe('gameModeFromPracticeType', () => {
    it('単 を singles に変換', () => {
      expect(gameModeFromPracticeType('単')).toBe('singles');
    });
    it('複 / 楽 は doubles に変換', () => {
      expect(gameModeFromPracticeType('複')).toBe('doubles');
      expect(gameModeFromPracticeType('楽')).toBe('doubles');
    });
    it('undefined は doubles にフォールバック', () => {
      expect(gameModeFromPracticeType(undefined)).toBe('doubles');
    });
  });

  describe('シングルスモードで3人のみでも試合配置できる（回帰テスト）', () => {
    it('1コート / 3人 / 連続モードONで配置が継続する', () => {
      const state: GameState = {
        players: [
          makePlayer('p1'),
          makePlayer('p2'),
          makePlayer('p3'),
        ],
        courts: [
          makeCourt(1, {
            teamA: ['p1', ''],
            teamB: ['p2', ''],
            isPlaying: true,
            startedAt: 1710500000000,
          }),
        ],
        matchHistory: [],
        reservations: [],
      };

      const result = computeFinishAndContinue(state, 1, {
        continuousMatchMode: true,
        useStayDurationPriority: true,
        prioritizeDiversity: false,
        gameMode: 'singles',
      });

      expect(result.continuousError).toBeUndefined();
      expect(result.continuousNextApplied).toBe(true);
      const court = result.newState.courts.find(c => c.id === 1);
      expect(court?.teamA.filter(id => id)).toHaveLength(1);
      expect(court?.teamB.filter(id => id)).toHaveLength(1);
    });
  });

  describe('既存のmatchHistoryが保持される', () => {
    it('既存の試合記録に追加される', () => {
      const state = makeBaseState();
      state.matchHistory = [{
        id: 'existing-match',
        courtId: 1,
        teamA: ['x1', 'x2'],
        teamB: ['x3', 'x4'],
        scoreA: 0,
        scoreB: 0,
        startedAt: 1710400000000,
        finishedAt: 1710400001000,
      }];

      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.newState.matchHistory).toHaveLength(2);
      expect(result.newState.matchHistory[0].id).toBe('existing-match');
    });
  });

  // 連続モード配置が 2 回目以降も動くための回帰テスト。
  // 旧実装では newState から settings が落ちて Firestore に書き戻され、
  // 次回 finish 時に remoteSettings.continuousMatchMode が undefined→false に
  // なって配置がスキップされていた。
  describe('settings の保持（回帰テスト）', () => {
    it('入力 state.settings が newState に残る', () => {
      const state: GameState = {
        ...makeBaseState(),
        settings: {
          recordScores: true,
          continuousMatchMode: true,
          practiceType: '複',
        },
      };

      const result = computeFinishAndContinue(state, 1, {
        ...defaultOptions,
        continuousMatchMode: true,
      });

      expect(result.newState.settings).toEqual({
        recordScores: true,
        continuousMatchMode: true,
        practiceType: '複',
      });
    });

    it('settings 未定義の入力では newState.settings も未定義', () => {
      const state = makeBaseState();
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.newState.settings).toBeUndefined();
    });
  });

  describe('未対応メンバーの試合終了ごとの強制休憩', () => {
    const NOW_MARKER = 1710000000000; // 過去の forcedRestAt（ボーダー超過済み）
    const unpaidResolved = { payment: true, roster: true, checkin: true };
    const unpaidUnresolved = { payment: false, roster: true, checkin: true };

    it('ボーダー超過済み(forcedRestAt有)で未払いのまま試合を終えると休憩へ戻し forcedRestAt を更新する', () => {
      const state = makeBaseState();
      state.players = state.players.map(p =>
        p.id === 'p1'
          ? { ...p, operationStatus: unpaidUnresolved, forcedRestAt: NOW_MARKER }
          : p,
      );
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      const p1 = result.newState.players.find(p => p.id === 'p1')!;
      expect(p1.isResting).toBe(true);
      expect(p1.forcedRestAt).toBeGreaterThan(NOW_MARKER);
      // 同席の対応済みメンバーは待機に戻る
      expect(result.newState.players.find(p => p.id === 'p2')!.isResting).toBe(false);
    });

    it('forcedRestAt 未設定（初回未発火）なら試合終了で休憩にはしない（30分猶予はポーリング側）', () => {
      const state = makeBaseState();
      state.players = state.players.map(p =>
        p.id === 'p1' ? { ...p, operationStatus: unpaidUnresolved } : p,
      );
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      const p1 = result.newState.players.find(p => p.id === 'p1')!;
      expect(p1.isResting).toBe(false);
      expect(p1.forcedRestAt).toBeUndefined();
    });

    it('会費・名簿とも対応済みなら forcedRestAt が残っていても休憩にしない', () => {
      const state = makeBaseState();
      state.players = state.players.map(p =>
        p.id === 'p1'
          ? { ...p, operationStatus: unpaidResolved, forcedRestAt: NOW_MARKER }
          : p,
      );
      const result = computeFinishAndContinue(state, 1, defaultOptions);
      const p1 = result.newState.players.find(p => p.id === 'p1')!;
      expect(p1.isResting).toBe(false);
      expect(p1.forcedRestAt).toBe(NOW_MARKER);
    });

    it('単・連続モードでも強制休憩者は次の自動配置に選ばれない', () => {
      // singles: 1コート2人。p1 が未対応かつボーダー超過済み。
      const state: GameState = {
        players: [
          makePlayer('p1', { operationStatus: unpaidUnresolved, forcedRestAt: NOW_MARKER }),
          makePlayer('p2'),
          makePlayer('p3'), makePlayer('p4'), makePlayer('p5'),
        ],
        courts: [makeCourt(1, { teamA: ['p1', ''], teamB: ['p2', ''], isPlaying: true, startedAt: 1710500000000 })],
        matchHistory: [],
        reservations: [],
      };
      const result = computeFinishAndContinue(state, 1, {
        ...defaultOptions,
        gameMode: 'singles',
        continuousMatchMode: true,
      });
      const p1 = result.newState.players.find(p => p.id === 'p1')!;
      expect(p1.isResting).toBe(true);
      // 次の試合（もし配置されていれば）に p1 は含まれない
      const nextCourt = result.newState.courts[0];
      expect([...nextCourt.teamA, ...nextCourt.teamB]).not.toContain('p1');
    });
  });
});

/**
 * 連続配置経路に `practiceStartTime` が渡ることの回帰テスト。
 *
 * 渡さないと `assignCourts` が `Date.now()` にフォールバックし、
 * `resolveStayStart` の `max(practiceStartTime, ...)` が常に now を返して
 * 全員の滞在時間が下限 5 分に潰れる。優先スコアが `gamesPlayed / 5` になり、
 * 待機時間優先モードが試合回数優先モードと同じ順序になってしまう（no-op 化）。
 * docs/plans/2026-08-11-stay-duration-mode-not-applied.md
 */
describe('computeFinishAndContinue: practiceStartTime と待機時間優先モード', () => {
  const MIN = 60_000;

  /**
   * 「長く居るが試合数も多い人」vs「来たばかりで試合数は少ない人」を作る。
   * - 待機時間優先: 滞在の長い OLD が優先される（8/120 < 3/20）
   * - 試合回数優先: 試合数の少ない NEW が優先される
   */
  function makeDivergentState(now: number, practiceStartTime: number): GameState {
    const players: Player[] = [];
    // コート上の 4 人（試合終了後は待機に戻る）
    for (let i = 0; i < 4; i++) {
      players.push(
        makePlayer(`ON${i}`, {
          rating: 30 - i,
          gamesPlayed: 8,
          activatedAt: practiceStartTime,
          operationStatus: { payment: true, roster: true, checkin: true },
          opsCompletedAt: practiceStartTime,
        }),
      );
    }
    // 開始から居る 8 人（試合数 8）
    for (let i = 0; i < 8; i++) {
      players.push(
        makePlayer(`OLD${i}`, {
          rating: 20 - i,
          gamesPlayed: 8,
          activatedAt: practiceStartTime,
          operationStatus: { payment: true, roster: true, checkin: true },
          opsCompletedAt: practiceStartTime,
        }),
      );
    }
    // 20 分前に来た 4 人（試合数 3）
    for (let i = 0; i < 4; i++) {
      players.push(
        makePlayer(`NEW${i}`, {
          rating: 16 - i,
          gamesPlayed: 3,
          activatedAt: now - 20 * MIN,
          operationStatus: { payment: true, roster: true, checkin: true },
          opsCompletedAt: now - 20 * MIN,
        }),
      );
    }
    return {
      players,
      courts: [
        makeCourt(1, {
          teamA: ['ON0', 'ON1'],
          teamB: ['ON2', 'ON3'],
          isPlaying: true,
          startedAt: now - 10 * MIN,
        }),
      ],
      matchHistory: [],
      reservations: [],
    };
  }

  function nextMembers(useStayDurationPriority: boolean, practiceStartTime?: number): string[] {
    const now = Date.now();
    const state = makeDivergentState(now, now - 120 * MIN);
    const result = computeFinishAndContinue(state, 1, {
      ...defaultOptions,
      continuousMatchMode: true,
      useStayDurationPriority,
      practiceStartTime,
    });
    const court = result.newState.courts.find(c => c.id === 1)!;
    return [...court.teamA, ...court.teamB].filter(id => id);
  }

  it('practiceStartTime を渡すと待機時間優先モードで滞在の長いメンバーが選ばれる', () => {
    const now = Date.now();
    const members = nextMembers(true, now - 120 * MIN);
    expect(members).toHaveLength(4);
    // 滞在 120 分・8 試合 (0.067) < 滞在 20 分・3 試合 (0.15) なので OLD が優先
    expect(members.every(id => id.startsWith('OLD'))).toBe(true);
  });

  it('試合回数優先モードでは試合数の少ないメンバーが選ばれる', () => {
    const now = Date.now();
    const members = nextMembers(false, now - 120 * MIN);
    expect(members).toHaveLength(4);
    expect(members.every(id => id.startsWith('NEW'))).toBe(true);
  });

  it('practiceStartTime を渡さないと両モードが同じ結果になる（退行検知）', () => {
    // このテストが落ちる = practiceStartTime 無しでもモード差が出るようになった、
    // つまり滞在時間が下限に潰れる前提が変わったということ。上 2 つの
    // テストと合わせて「practiceStartTime を渡す実装」を担保する。
    expect(nextMembers(true)).toEqual(nextMembers(false));
  });
});
