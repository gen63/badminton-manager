import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn(async () => ({ 複: { maleFee: 700, femaleFee: 650 } }));

vi.mock('../services/appConfigService', () => ({
  fetchDefaultFeesSafe: () => mockFetch(),
}));

import { loadDefaultFees, invalidateDefaultFeesCache } from './useDefaultFees';

describe('useDefaultFees のキャッシュ', () => {
  beforeEach(() => {
    invalidateDefaultFeesCache();
    mockFetch.mockClear();
  });

  it('2 回目以降の呼び出しは Firestore を叩かずキャッシュを返す', async () => {
    const first = await loadDefaultFees();
    const second = await loadDefaultFees();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second).toEqual({ 複: { maleFee: 700, femaleFee: 650 } });
  });

  it('同時呼び出しでも取得は 1 回だけ', async () => {
    await Promise.all([loadDefaultFees(), loadDefaultFees(), loadDefaultFees()]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('invalidateDefaultFeesCache 後は再取得する', async () => {
    await loadDefaultFees();
    invalidateDefaultFeesCache();
    await loadDefaultFees();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
