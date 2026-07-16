import { describe, it, expect } from 'vitest';
import { getMatchUploadBadge, needsAccountingUploadBadge } from './uploadStatus';
import type { Session } from '../types/session';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'TEST01',
    config: { courtCount: 2, targetScore: 21, practiceStartTime: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const accountingInput: NonNullable<Session['accounting']> = {
  exemptCount: 0,
  maleCount: 5,
  femaleCount: 3,
  maleFee: 800,
  femaleFee: 600,
  gymCost: 900,
  shuttlePrice: 510,
  shuttleCount: 2,
  matchCount: 10,
  practiceType: '複',
};

describe('getMatchUploadBadge', () => {
  it('試合が 0 件ならバッジ不要', () => {
    expect(getMatchUploadBadge(makeSession({ matchCount: 0 }))).toBe('none');
    expect(getMatchUploadBadge(makeSession())).toBe('none'); // matchCount 未設定
  });

  it('試合があるのに未アップロードなら not-uploaded', () => {
    expect(getMatchUploadBadge(makeSession({ matchCount: 5 }))).toBe('not-uploaded');
  });

  it('アップロード済みで試合数が一致していればバッジ不要', () => {
    const session = makeSession({
      matchCount: 5,
      matchUpload: { uploadedAt: Date.now(), matchCount: 5 },
    });
    expect(getMatchUploadBadge(session)).toBe('none');
  });

  it('アップロード後に試合が増えていれば stale', () => {
    const session = makeSession({
      matchCount: 7,
      matchUpload: { uploadedAt: Date.now(), matchCount: 5 },
    });
    expect(getMatchUploadBadge(session)).toBe('stale');
  });

  it('アップロード後に試合が減っても（削除）バッジは出さない', () => {
    const session = makeSession({
      matchCount: 3,
      matchUpload: { uploadedAt: Date.now(), matchCount: 5 },
    });
    expect(getMatchUploadBadge(session)).toBe('none');
  });

  it('勝敗記録モード OFF なら試合があってもバッジを出さない', () => {
    expect(
      getMatchUploadBadge(makeSession({ matchCount: 5, recordScores: false })),
    ).toBe('none');
    // アップロード後に試合が増えても OFF なら stale も出さない
    expect(
      getMatchUploadBadge(
        makeSession({
          matchCount: 7,
          recordScores: false,
          matchUpload: { uploadedAt: Date.now(), matchCount: 5 },
        }),
      ),
    ).toBe('none');
  });

  it('勝敗記録モード ON / 未設定なら従来どおりバッジを出す', () => {
    expect(getMatchUploadBadge(makeSession({ matchCount: 5, recordScores: true }))).toBe(
      'not-uploaded',
    );
    expect(getMatchUploadBadge(makeSession({ matchCount: 5 }))).toBe('not-uploaded');
  });
});

describe('needsAccountingUploadBadge', () => {
  it('会計未入力ならバッジ不要', () => {
    expect(needsAccountingUploadBadge(makeSession())).toBe(false);
  });

  it('会計入力があり未アップロードならバッジを出す', () => {
    expect(needsAccountingUploadBadge(makeSession({ accounting: accountingInput }))).toBe(true);
  });

  it('会計入力がありアップロード済みならバッジ不要', () => {
    const session = makeSession({
      accounting: accountingInput,
      accountingUpload: { uploadedAt: Date.now() },
    });
    expect(needsAccountingUploadBadge(session)).toBe(false);
  });
});
