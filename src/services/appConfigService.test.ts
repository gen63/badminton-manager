import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetDoc = vi.fn();

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn(() => ({ __docRef: true })),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    setDoc: vi.fn(async () => undefined),
  };
});

vi.mock('../lib/firestoreUtils', () => ({
  requireDb: () => ({ __mockDb: true }),
}));

import { fetchDefaultFeesSafe, getDefaultFees } from './appConfigService';

function snapshot(data: unknown) {
  return { exists: () => true, data: () => data };
}

describe('fetchDefaultFeesSafe', () => {
  beforeEach(() => {
    mockGetDoc.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('読み取りが失敗しても例外を投げず {} を返す', async () => {
    mockGetDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(fetchDefaultFeesSafe()).resolves.toEqual({});
  });

  it('document が存在しなければ {} を返す', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(fetchDefaultFeesSafe()).resolves.toEqual({});
  });

  it('defaultFees が未設定なら {} を返す', async () => {
    mockGetDoc.mockResolvedValue(snapshot({ defaultAnnouncement: { text: 'hi' } }));
    await expect(fetchDefaultFeesSafe()).resolves.toEqual({});
  });

  it('保存済みの fees をそのまま返す', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ defaultFees: { fees: { 複: { maleFee: 700, femaleFee: 650 } }, updatedAt: 1 } }),
    );
    await expect(fetchDefaultFeesSafe()).resolves.toEqual({
      複: { maleFee: 700, femaleFee: 650 },
    });
  });

  it('0 未満・非整数・欠損の金額を含む種別は除外する', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({
        defaultFees: {
          fees: {
            複: { maleFee: -1, femaleFee: 600 },
            単: { maleFee: 1000.5, femaleFee: 800 },
            楽: { maleFee: 500 },
            他: { maleFee: 0, femaleFee: 0 },
          },
          updatedAt: 1,
        },
      }),
    );
    await expect(fetchDefaultFeesSafe()).resolves.toEqual({ 他: { maleFee: 0, femaleFee: 0 } });
  });
});

describe('getDefaultFees', () => {
  beforeEach(() => {
    mockGetDoc.mockReset();
  });

  it('読み取り失敗はそのまま throw する（編集 UI 用）', async () => {
    mockGetDoc.mockRejectedValue(new Error('boom'));
    await expect(getDefaultFees()).rejects.toThrow('boom');
  });
});
