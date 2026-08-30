const KEY = 'dev-mode';

/**
 * 開発モードの有効化コード。`?dev=<コード>` で有効化し、同じ値を
 * localStorage に保存する。値を変えると既存端末の開発モードは無効になり、
 * 新しいコード付き URL を開き直すまで復活しない（= 実質的な失効手段）。
 */
export const DEV_MODE_CODE = '232';

export function applyDevModeFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('dev') === DEV_MODE_CODE) {
    localStorage.setItem(KEY, DEV_MODE_CODE);
  }
}

export function useDevMode(): boolean {
  return localStorage.getItem(KEY) === DEV_MODE_CODE;
}
