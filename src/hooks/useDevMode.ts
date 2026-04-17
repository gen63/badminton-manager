const KEY = 'dev-mode';

export function applyDevModeFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('dev') === '1') {
    localStorage.setItem(KEY, '1');
  }
}

export function useDevMode(): boolean {
  return localStorage.getItem(KEY) === '1';
}
