/**
 * グローバル既定参加費（appConfig/global.defaultFees）を読み込む hook。
 *
 * 会費を参照する画面すべてで使うため、モジュールレベルで Promise をキャッシュし
 * 画面遷移のたびに Firestore を読まないようにする。保存直後は
 * `invalidateDefaultFeesCache()` でキャッシュを破棄する。
 *
 * 読み込み中（`loaded === false`）は空の overrides を返す。呼び出し側はコード定数で
 * 描画し、読み込み完了後に差し替える（初期表示をブロックしない）。
 */

import { useEffect, useState } from 'react';
import { fetchDefaultFeesSafe } from '../services/appConfigService';
import type { FeeOverrides } from '../lib/accountingCalc';

const EMPTY_FEES: FeeOverrides = {};

let cachedPromise: Promise<FeeOverrides> | null = null;

/** キャッシュ経由で既定会費を取得（未キャッシュなら 1 度だけ Firestore を読む） */
export function loadDefaultFees(): Promise<FeeOverrides> {
  if (!cachedPromise) {
    cachedPromise = fetchDefaultFeesSafe();
  }
  return cachedPromise;
}

/** 既定会費の保存後など、次回読み込みで Firestore を読み直させる */
export function invalidateDefaultFeesCache(): void {
  cachedPromise = null;
}

export interface UseDefaultFeesResult {
  fees: FeeOverrides;
  loaded: boolean;
}

export function useDefaultFees(): UseDefaultFeesResult {
  const [state, setState] = useState<UseDefaultFeesResult>({ fees: EMPTY_FEES, loaded: false });

  useEffect(() => {
    let cancelled = false;
    loadDefaultFees().then((fees) => {
      if (!cancelled) setState({ fees, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
