/**
 * useFirebaseSync統合テスト
 * 
 * 注意: このテストはモック/スタブの複雑さから、現在はスキップされています。
 * 同期ロジックの核心部分は src/lib/syncUtils.test.ts でカバーされています。
 * 
 * 実際の同期動作のテストは以下で行うことを推奨：
 * 1. E2Eテスト（Playwright/Cypressなど）
 * 2. 手動テスト（複数ブラウザで同時操作）
 * 3. Firestore Emulator を使った統合テスト
 */

import { describe, it, expect } from 'vitest';
import { shouldApplyRemoteData } from '../lib/syncUtils';

describe('useFirebaseSync - 同期シナリオ（簡易シミュレーション）', () => {
  it('シナリオ1: 2つのクライアントが同時に更新', () => {
    const now = Date.now();

    // クライアントA: プレイヤーを休憩に変更 → push
    const clientA_pushTime = now;
    const clientA_hash = 'hash-A';

    // クライアントB: 別のプレイヤーを休憩に変更 → push
    const clientB_pushTime = now + 10;
    const clientB_hash = 'hash-B';

    // Firestoreで先にコミットされたのはクライアントA
    const remote_updatedAt = clientA_pushTime + 50;

    // クライアントBがクライアントAのデータを受信
    const decision = shouldApplyRemoteData({
      incomingHash: clientA_hash,
      lastPushedHash: clientB_hash, // 自分が送ったのはhash-B
      remoteUpdatedAt: remote_updatedAt,
      lastAppliedRemoteUpdatedAt: 0, // 初回
      lastPushedTime: clientB_pushTime,
      currentTime: now + 100,
      pushBlockMs: 500,
    });

    // クライアントAのデータは適用されない（push後500ms以内）
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain('too soon after push');
  });

  it('シナリオ2: push完了後、新しいデータを受信', () => {
    const now = Date.now();

    // クライアントA: データをpush
    const clientA_pushTime = now;
    const clientA_hash = 'hash-A';

    // 600ms後、クライアントBからの新しいデータを受信
    const remote_updatedAt = now + 600;
    const remote_hash = 'hash-B';

    const decision = shouldApplyRemoteData({
      incomingHash: remote_hash,
      lastPushedHash: clientA_hash,
      remoteUpdatedAt: remote_updatedAt,
      lastAppliedRemoteUpdatedAt: 0,
      lastPushedTime: clientA_pushTime,
      currentTime: now + 650, // push後650ms
      pushBlockMs: 500,
    });

    // 500ms経過しているので適用される
    expect(decision.shouldApply).toBe(true);
  });

  it('シナリオ3: ネットワーク遅延で古いデータが後から届く', () => {
    const now = Date.now();

    // 時刻1000: データAを受信・適用
    const firstData_updatedAt = now + 1000;
    
    // 時刻2000: データBを受信・適用
    const secondData_updatedAt = now + 2000;

    // 時刻3000: データA（遅延）が再度届く
    const lateData_updatedAt = firstData_updatedAt; // 時刻1000のデータ

    const decision = shouldApplyRemoteData({
      incomingHash: 'hash-late',
      lastPushedHash: 'hash-local',
      remoteUpdatedAt: lateData_updatedAt,
      lastAppliedRemoteUpdatedAt: secondData_updatedAt, // 既にデータBを適用済み
      lastPushedTime: 0,
      currentTime: now + 3000,
      pushBlockMs: 500,
    });

    // 古いデータなのでスキップ
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain('older remote data');
  });

  it('シナリオ4: 自分がpushしたデータのエコーバック', () => {
    const now = Date.now();

    // 自分がpushしたデータのハッシュ
    const myHash = 'hash-my-data';

    // 同じデータがリモートから返ってくる
    const decision = shouldApplyRemoteData({
      incomingHash: myHash,
      lastPushedHash: myHash, // 一致
      remoteUpdatedAt: now + 1000,
      lastAppliedRemoteUpdatedAt: 0,
      lastPushedTime: now - 1000, // 十分時間が経過
      currentTime: now,
      pushBlockMs: 500,
    });

    // 自分のデータなのでスキップ
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toBe('same as last push');
  });
});
