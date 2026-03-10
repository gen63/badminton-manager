import { describe, it, expect } from 'vitest';
import { getTimestampMillis, hashGameState, shouldApplyRemoteData } from './syncUtils';

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
});
