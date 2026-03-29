import { describe, it, expect } from 'vitest';
import { getTimestampMillis, hashGameState, shouldApplyRemoteData, mergeGameState, type SyncGameState } from './syncUtils';

// テスト用のヘルパー: マージ結果のプレイヤー/コート等から任意プロパティを取得
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prop = (obj: any, key: string) => obj[key];

describe('syncUtils', () => {
  describe('getTimestampMillis', () => {
    it('数値（ミリ秒）をそのまま返す', () => {
      expect(getTimestampMillis(1234567890)).toBe(1234567890);
    });

    it('null/undefinedの場合はnullを返す', () => {
      expect(getTimestampMillis(null)).toBe(null);
      expect(getTimestampMillis(undefined)).toBe(null);
    });

    it('Firestore Timestamp型（toMillis）を変換', () => {
      const mockTimestamp = {
        toMillis: () => 1234567890,
      };
      expect(getTimestampMillis(mockTimestamp)).toBe(1234567890);
    });

    it('Firestore Timestamp型（seconds）を変換', () => {
      const mockTimestamp = {
        seconds: 1234567,
        nanoseconds: 890000000,
      };
      expect(getTimestampMillis(mockTimestamp)).toBe(1234567000);
    });

    it('不明な形式の場合はnullを返す', () => {
      expect(getTimestampMillis('invalid')).toBe(null);
      expect(getTimestampMillis({})).toBe(null);
      expect(getTimestampMillis({ invalid: true })).toBe(null);
    });
  });

  describe('hashGameState', () => {
    it('同じデータは同じハッシュを返す', () => {
      const data1 = {
        players: [{ id: '1', name: 'A' }],
        courts: [],
        matchHistory: [],
        reservations: [],
      };
      const data2 = {
        players: [{ id: '1', name: 'A' }],
        courts: [],
        matchHistory: [],
        reservations: [],
      };
      expect(hashGameState(data1)).toBe(hashGameState(data2));
    });

    it('異なるデータは異なるハッシュを返す', () => {
      const data1 = {
        players: [{ id: '1', name: 'A' }],
        courts: [],
        matchHistory: [],
        reservations: [],
      };
      const data2 = {
        players: [{ id: '1', name: 'B' }],
        courts: [],
        matchHistory: [],
        reservations: [],
      };
      expect(hashGameState(data1)).not.toBe(hashGameState(data2));
    });
  });

  describe('shouldApplyRemoteData', () => {
    const baseParams = {
      incomingHash: 'hash-remote',
      lastPushedHash: 'hash-local',
      remoteUpdatedAt: 2000,
      lastAppliedRemoteUpdatedAt: 1000,
      lastPushedTime: 0,
      currentTime: 10000,
      pushBlockMs: 500,
    };

    it('通常のケースでは適用する', () => {
      const result = shouldApplyRemoteData(baseParams);
      expect(result.shouldApply).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('自分がpushしたデータと同じならスキップ', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        incomingHash: 'same-hash',
        lastPushedHash: 'same-hash',
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toBe('same as last push');
    });

    it('リモートデータが古い場合はスキップ', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        remoteUpdatedAt: 900, // lastAppliedRemoteUpdatedAt (1000) より古い
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toContain('older remote data');
    });

    it('リモートデータが同じ時刻の場合もスキップ', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        remoteUpdatedAt: 1000, // lastAppliedRemoteUpdatedAt と同じ
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toContain('older remote data');
    });

    it('初回（lastAppliedRemoteUpdatedAt=0）の場合は適用する', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        lastAppliedRemoteUpdatedAt: 0,
        remoteUpdatedAt: 100,
      });
      expect(result.shouldApply).toBe(true);
    });

    it('push直後（500ms以内）はスキップ', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        lastPushedTime: 9800, // 現在時刻10000 - 200ms
        currentTime: 10000,
        pushBlockMs: 500,
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toContain('too soon after push');
    });

    it('push後500ms経過後は適用する', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        lastPushedTime: 9400, // 現在時刻10000 - 600ms
        currentTime: 10000,
        pushBlockMs: 500,
      });
      expect(result.shouldApply).toBe(true);
    });

    it('pushBlockMsをカスタマイズできる', () => {
      const result = shouldApplyRemoteData({
        ...baseParams,
        lastPushedTime: 9800, // 現在時刻10000 - 200ms
        currentTime: 10000,
        pushBlockMs: 100, // 100msに設定
      });
      expect(result.shouldApply).toBe(true); // 200ms経過しているので適用
    });
  });

  describe('shouldApplyRemoteData - エッジケース', () => {
    it('複数の条件が重なった場合、最初のスキップ条件が優先される', () => {
      // ハッシュが同じ && 古いデータ && push直後
      const result = shouldApplyRemoteData({
        incomingHash: 'same',
        lastPushedHash: 'same',
        remoteUpdatedAt: 500,
        lastAppliedRemoteUpdatedAt: 1000,
        lastPushedTime: 9900,
        currentTime: 10000,
        pushBlockMs: 500,
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toBe('same as last push'); // 最初の条件
    });

    it('タイムスタンプが同じでハッシュが異なる場合はスキップ（古いデータ判定）', () => {
      const result = shouldApplyRemoteData({
        incomingHash: 'hash-A',
        lastPushedHash: 'hash-B',
        remoteUpdatedAt: 1000,
        lastAppliedRemoteUpdatedAt: 1000,
        lastPushedTime: 0,
        currentTime: 10000,
        pushBlockMs: 500,
      });
      expect(result.shouldApply).toBe(false);
      expect(result.reason).toContain('older remote data');
    });
  });

  describe('mergeGameState', () => {
    const makePlayer = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      name: `Player ${id}`,
      isResting: false,
      gamesPlayed: 0,
      ...overrides,
    });

    const makeCourt = (id: number, overrides: Record<string, unknown> = {}) => ({
      id,
      teamA: ['', ''],
      teamB: ['', ''],
      isPlaying: false,
      scoreA: 0,
      scoreB: 0,
      startedAt: 0,
      finishedAt: 0,
      ...overrides,
    });

    const makeMatch = (id: string, startedAt: number, overrides: Record<string, unknown> = {}) => ({
      id,
      courtId: 1,
      teamA: ['p1', 'p2'],
      teamB: ['p3', 'p4'],
      scoreA: 0,
      scoreB: 0,
      startedAt,
      finishedAt: startedAt + 1000,
      ...overrides,
    });

    const makeReservation = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      orderNumber: 1,
      playerIds: ['p1'],
      status: 'pending' as const,
      createdAt: 1000,
      fulfilledAt: 0,
      ...overrides,
    });

    const emptyState: SyncGameState = {
      players: [],
      courts: [],
      matchHistory: [],
      reservations: [],
    };

    it('baseがnullの場合、localをそのまま返す', () => {
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('1')],
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('1', { isResting: true })],
      };
      const result = mergeGameState(null, local, remote);
      expect(result).toBe(local);
    });

    it('ローカルとリモートでそれぞれ異なるプレイヤーを変更 → 両方反映', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: true }),
          makePlayer('B', { isResting: true }),
        ],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: false }), // ローカルでAを復帰
          makePlayer('B', { isResting: true }),   // Bは変更なし
        ],
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: true }),   // Aは変更なし（リモート側）
          makePlayer('B', { isResting: false }),  // リモートでBを復帰
        ],
      };

      const result = mergeGameState(base, local, remote);
      expect(result.players).toHaveLength(2);
      expect(prop(result.players.find(p => p.id === 'A'), 'isResting')).toBe(false);  // ローカル変更
      expect(prop(result.players.find(p => p.id === 'B'), 'isResting')).toBe(false);  // リモート変更
    });

    it('同じプレイヤーを両方が変更 → ローカル優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: true, gamesPlayed: 0 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: false, gamesPlayed: 0 })],
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: true, gamesPlayed: 5 })],
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.players[0], 'isResting')).toBe(false); // ローカル優先
      expect(prop(result.players[0], 'gamesPlayed')).toBe(0);   // ローカル版の値
    });

    it('ローカルでプレイヤー追加 + リモートでも別プレイヤー追加 → 両方追加', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A')],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('B')], // Bをローカル追加
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('C')], // Cをリモート追加
      };

      const result = mergeGameState(base, local, remote);
      expect(result.players).toHaveLength(3);
      expect(result.players.map(p => p.id).sort()).toEqual(['A', 'B', 'C']);
    });

    it('ローカルでプレイヤー削除 → マージ後も削除', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('B')],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A')], // Bをローカル削除
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('B')], // Bはリモートに残っている
      };

      const result = mergeGameState(base, local, remote);
      expect(result.players).toHaveLength(1);
      expect(result.players[0].id).toBe('A');
    });

    it('リモートでプレイヤー削除 → マージ後も削除', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('B')],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A'), makePlayer('B')], // ローカル変更なし
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A')], // Bをリモート削除
      };

      const result = mergeGameState(base, local, remote);
      expect(result.players).toHaveLength(1);
      expect(result.players[0].id).toBe('A');
    });

    it('courtsマージ: ローカルでコート状態変更 + リモートで別コート状態変更', () => {
      const base: SyncGameState = {
        ...emptyState,
        courts: [makeCourt(1), makeCourt(2)],
      };
      const local: SyncGameState = {
        ...emptyState,
        courts: [
          makeCourt(1, { teamA: ['p1', 'p2'] }), // ローカルでコート1に配置
          makeCourt(2),
        ],
      };
      const remote: SyncGameState = {
        ...emptyState,
        courts: [
          makeCourt(1),
          makeCourt(2, { isPlaying: true, startedAt: 1000 }), // リモートでコート2開始
        ],
      };

      const result = mergeGameState(base, local, remote);
      expect(result.courts).toHaveLength(2);
      expect(prop(result.courts.find(c => c.id === 1), 'teamA')).toEqual(['p1', 'p2']); // ローカル
      expect(prop(result.courts.find(c => c.id === 2), 'isPlaying')).toBe(true); // リモート
    });

    it('matchHistory: 重複なしの和集合 + 時系列ソート', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000)],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000), makeMatch('m2', 3000)], // m2追加
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000), makeMatch('m3', 2000)], // m3追加
      };

      const result = mergeGameState(base, local, remote);
      expect(result.matchHistory).toHaveLength(3);
      // 時系列ソート
      expect(result.matchHistory.map(m => m.id)).toEqual(['m1', 'm3', 'm2']);
    });

    it('matchHistory: ローカルでスコア編集 → ローカル版優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 10, scoreB: 15 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 15, scoreB: 10 })], // スコア修正
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 10, scoreB: 15 })],
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.matchHistory[0], 'scoreA')).toBe(15);
      expect(prop(result.matchHistory[0], 'scoreB')).toBe(10);
    });

    it('matchHistory: ローカルで削除 → マージ後も削除', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000), makeMatch('m2', 2000)],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000)], // m2を削除
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000), makeMatch('m2', 2000)],
      };

      const result = mergeGameState(base, local, remote);
      expect(result.matchHistory).toHaveLength(1);
      expect(result.matchHistory[0].id).toBe('m1');
    });

    it('reservationsマージ: ローカルで成立 + リモートで新規追加', () => {
      const base: SyncGameState = {
        ...emptyState,
        reservations: [makeReservation('r1')],
      };
      const local: SyncGameState = {
        ...emptyState,
        reservations: [makeReservation('r1', { status: 'fulfilled', fulfilledAt: 5000 })],
      };
      const remote: SyncGameState = {
        ...emptyState,
        reservations: [makeReservation('r1'), makeReservation('r2', { orderNumber: 2 })],
      };

      const result = mergeGameState(base, local, remote);
      expect(result.reservations).toHaveLength(2);
      expect(prop(result.reservations.find(r => r.id === 'r1'), 'status')).toBe('fulfilled'); // ローカル変更
      expect(result.reservations.find(r => r.id === 'r2')).toBeDefined(); // リモート追加
    });

    it('settings: ローカルの設定を優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true },
      };
      const local: SyncGameState = {
        ...emptyState,
        settings: { recordScores: false },
      };
      const remote: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true, continuousMatchMode: false },
      };

      const result = mergeGameState(base, local, remote);
      expect(result.settings).toEqual({ recordScores: false }); // ローカル優先
    });

    it('3クライアント同時休憩復帰シナリオ', () => {
      // 3人が同時に休憩から復帰するシナリオ
      const base: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: true }),
          makePlayer('B', { isResting: true }),
          makePlayer('C', { isResting: true }),
        ],
      };

      // Client 1がAを復帰、Client 2がBを復帰し先にpush成功
      // Client 1のpush時: local=A復帰, remote=B復帰（Client2の結果）
      const local1: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: false }), // ローカルでA復帰
          makePlayer('B', { isResting: true }),
          makePlayer('C', { isResting: true }),
        ],
      };
      const remote1: SyncGameState = {
        ...emptyState,
        players: [
          makePlayer('A', { isResting: true }),
          makePlayer('B', { isResting: false }), // リモートでB復帰済み
          makePlayer('C', { isResting: true }),
        ],
      };

      const result1 = mergeGameState(base, local1, remote1);
      expect(prop(result1.players.find(p => p.id === 'A'), 'isResting')).toBe(false); // A復帰（ローカル）
      expect(prop(result1.players.find(p => p.id === 'B'), 'isResting')).toBe(false); // B復帰（リモート保持）
      expect(prop(result1.players.find(p => p.id === 'C'), 'isResting')).toBe(true);  // C未変更
    });
  });
});
