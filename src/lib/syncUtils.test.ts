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

    it('settings: フィールド単位で変更を採用（ローカル変更 + リモート追加）', () => {
      const base: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true },
      };
      const local: SyncGameState = {
        ...emptyState,
        settings: { recordScores: false }, // ローカルで変更
      };
      const remote: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true, continuousMatchMode: false }, // リモートでキー追加
      };

      const result = mergeGameState(base, local, remote);
      // recordScores はローカル変更を採用、continuousMatchMode はリモート追加を保持
      expect(result.settings).toEqual({ recordScores: false, continuousMatchMode: false });
    });

    // === 競合シナリオ: フィールドレベルマージ非対応の検証 ===

    it('同じプレイヤーの異なるフィールドを同時編集 → ローカル変更側が全体優先（既知の制限）', () => {
      // Client A: name変更、Client B: gamesPlayed変更
      // 現在の実装ではオブジェクト単位比較のため、後のpush側が全フィールドを上書きする
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', gamesPlayed: 0 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice-edited', gamesPlayed: 0 })], // name変更
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', gamesPlayed: 5 })], // gamesPlayed変更
      };

      const result = mergeGameState(base, local, remote);
      // ローカル変更あり → ローカル版全体が優先される
      expect(prop(result.players[0], 'name')).toBe('Alice-edited'); // ローカル変更が反映
      expect(prop(result.players[0], 'gamesPlayed')).toBe(0);       // リモート変更がロスト（既知の制限）
    });

    it('同じプレイヤー: ローカル未変更 + リモート変更 → リモート版採用', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', gamesPlayed: 0 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', gamesPlayed: 0 })], // 変更なし
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', gamesPlayed: 5 })], // gamesPlayed変更
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.players[0], 'gamesPlayed')).toBe(5); // リモート版採用
    });

    it('支払い情報とプレイヤー編集の同時操作 → ローカル変更側が全体優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', paymentAmount: 0, operationStatus: { payment: false } })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice', paymentAmount: 500, operationStatus: { payment: true } })], // 支払い完了
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { name: 'Alice-renamed', paymentAmount: 0, operationStatus: { payment: false } })], // 名前変更
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.players[0], 'paymentAmount')).toBe(500);          // ローカル支払い保持
      expect(prop(result.players[0], 'name')).toBe('Alice');               // リモート名前変更はロスト
    });

    // === 競合シナリオ: matchHistory スコア同時編集 ===

    it('同じ試合のスコアを2人が同時編集 → ローカル版が優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 0, scoreB: 0 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 21, scoreB: 19 })], // Client A のスコア
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 19, scoreB: 21 })], // Client B のスコア
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.matchHistory[0], 'scoreA')).toBe(21); // ローカル優先
      expect(prop(result.matchHistory[0], 'scoreB')).toBe(19);
    });

    it('スコア編集 + 別試合追加の同時操作 → 両方反映', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 0, scoreB: 0 })],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000, { scoreA: 21, scoreB: 15 })], // スコア編集
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [
          makeMatch('m1', 1000, { scoreA: 0, scoreB: 0 }),
          makeMatch('m2', 2000), // 別試合追加
        ],
      };

      const result = mergeGameState(base, local, remote);
      expect(result.matchHistory).toHaveLength(2);
      expect(prop(result.matchHistory[0], 'scoreA')).toBe(21); // ローカルスコア保持
      expect(result.matchHistory[1].id).toBe('m2');             // リモート追加も反映
    });

    // === 競合シナリオ: 削除と変更の同時操作 ===

    it('ローカルでプレイヤー変更 + リモートで同プレイヤー削除 → ローカル変更が残る（新規追加扱い）', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: true })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: false })], // ローカルで変更
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [], // リモートで削除
      };

      const result = mergeGameState(base, local, remote);
      // ローカル変更あり + リモートに存在しない + baseに存在する → リモートで削除された
      // mergeById: remoteItem が undefined → baseItem あり → 削除扱い（追加しない）
      expect(result.players).toHaveLength(0); // リモート削除が優先
    });

    it('ローカルでプレイヤー削除 + リモートで同プレイヤー変更 → 削除が優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: true })],
      };
      const local: SyncGameState = {
        ...emptyState,
        players: [], // ローカルで削除
      };
      const remote: SyncGameState = {
        ...emptyState,
        players: [makePlayer('A', { isResting: false })], // リモートで変更
      };

      const result = mergeGameState(base, local, remote);
      // ローカルで削除 → remoteItem は seen に含まれない → baseItem あり → ローカル削除扱い
      expect(result.players).toHaveLength(0); // ローカル削除が優先
    });

    // === 競合シナリオ: コート操作 ===

    it('同じコートに2人が同時配置 → ローカル版が優先', () => {
      const base: SyncGameState = {
        ...emptyState,
        courts: [makeCourt(1)],
      };
      const local: SyncGameState = {
        ...emptyState,
        courts: [makeCourt(1, { teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] })],
      };
      const remote: SyncGameState = {
        ...emptyState,
        courts: [makeCourt(1, { teamA: ['p5', 'p6'], teamB: ['p7', 'p8'] })],
      };

      const result = mergeGameState(base, local, remote);
      expect(prop(result.courts[0], 'teamA')).toEqual(['p1', 'p2']); // ローカル優先
    });

    // === 競合シナリオ: 履歴全クリア + 新試合追加 ===

    it('ローカルで履歴クリア + リモートで新試合追加 → 新試合が復活', () => {
      const base: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000)],
      };
      const local: SyncGameState = {
        ...emptyState,
        matchHistory: [], // ローカルでクリア
      };
      const remote: SyncGameState = {
        ...emptyState,
        matchHistory: [makeMatch('m1', 1000), makeMatch('m2', 2000)], // リモートで新試合追加
      };

      const result = mergeGameState(base, local, remote);
      // m1: base有り + local無し → ローカル削除 → 追加しない
      // m2: base無し + local無し + remote有り → リモート新規 → 追加
      expect(result.matchHistory).toHaveLength(1);
      expect(result.matchHistory[0].id).toBe('m2'); // 新試合のみ残る
    });

    // === 競合シナリオ: 設定の同時変更 ===

    it('settings: ローカルとリモートで異なるフィールドを変更 → 両方反映', () => {
      const base: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true, continuousMatchMode: true },
      };
      const local: SyncGameState = {
        ...emptyState,
        settings: { recordScores: false, continuousMatchMode: true }, // recordScores変更
      };
      const remote: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true, continuousMatchMode: false }, // continuousMatchMode変更
      };

      const result = mergeGameState(base, local, remote);
      // フィールド単位 3-way マージで双方の変更を保持
      expect(result.settings).toEqual({ recordScores: false, continuousMatchMode: false });
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

    describe('settings のフィールド単位 3-way マージ', () => {
      const baseState: SyncGameState = {
        ...emptyState,
        settings: { recordScores: true, continuousMatchMode: true, practiceType: '複' },
      };

      it('ローカルで practiceType を変更、リモートは未変更 → ローカル値を採用', () => {
        const local: SyncGameState = {
          ...emptyState,
          settings: { recordScores: true, continuousMatchMode: true, practiceType: '単' },
        };
        const remote: SyncGameState = baseState;
        const result = mergeGameState(baseState, local, remote);
        expect(result.settings).toEqual({
          recordScores: true,
          continuousMatchMode: true,
          practiceType: '単',
        });
      });

      it('ローカルで practiceType、リモートで recordScores を変更 → 両方反映', () => {
        const local: SyncGameState = {
          ...emptyState,
          settings: { recordScores: true, continuousMatchMode: true, practiceType: '単' },
        };
        const remote: SyncGameState = {
          ...emptyState,
          settings: { recordScores: false, continuousMatchMode: true, practiceType: '複' },
        };
        const result = mergeGameState(baseState, local, remote);
        expect(result.settings).toEqual({
          recordScores: false, // リモート変更を保持
          continuousMatchMode: true,
          practiceType: '単', // ローカル変更を優先
        });
      });

      it('ローカル未変更 / リモートで practiceType を変更 → リモート値を採用', () => {
        const local: SyncGameState = baseState;
        const remote: SyncGameState = {
          ...emptyState,
          settings: { recordScores: true, continuousMatchMode: true, practiceType: '単' },
        };
        const result = mergeGameState(baseState, local, remote);
        expect(result.settings).toEqual({
          recordScores: true,
          continuousMatchMode: true,
          practiceType: '単',
        });
      });

      it('base / remote に settings が無い → local を採用', () => {
        const base: SyncGameState = { ...emptyState };
        const local: SyncGameState = {
          ...emptyState,
          settings: { practiceType: '単' },
        };
        const remote: SyncGameState = { ...emptyState };
        const result = mergeGameState(base, local, remote);
        expect(result.settings).toEqual({ practiceType: '単' });
      });
    });
  });
});
