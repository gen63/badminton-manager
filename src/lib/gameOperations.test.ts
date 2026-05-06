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

  describe('restingPlayerIds の復元', () => {
    it('休憩プレイヤーが休憩状態に戻る', () => {
      const state = makeBaseState();
      // p5を休憩中にしてコートに配置（restingPlayerIdsに記録）
      state.players = state.players.map(p =>
        p.id === 'p5' ? { ...p, isResting: false } : p
      );
      state.courts[0].restingPlayerIds = ['p5'];

      const result = computeFinishAndContinue(state, 1, defaultOptions);
      expect(result.newState.players.find(p => p.id === 'p5')?.isResting).toBe(true);
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

    it('diversity block 発動時は settings.continuousMatchMode を OFF にする', () => {
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
      expect(result.newState.settings?.continuousMatchMode).toBe(false);
      // 他の settings は保持
      expect(result.newState.settings?.recordScores).toBe(true);
      expect(result.newState.settings?.practiceType).toBe('楽');
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
});
