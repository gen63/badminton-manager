import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function PWAPrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (r) {
        // 1分ごとにSWの更新をチェック
        setInterval(() => {
          r.update().catch(() => {});
        }, 1 * 60 * 1000);

        // 画面表示時 & フォーカス時に即座に更新チェック
        const checkForUpdates = () => {
          r.update().catch(() => {});
        };

        checkForUpdates();

        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            checkForUpdates();
          }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  // 更新検知時に自動リロード
  useEffect(() => {
    if (needRefresh) {
      updateServiceWorker(true); // true = skipWaitingで即座に適用してリロード
    }
  }, [needRefresh, updateServiceWorker]);

  // autoUpdateモード: 新バージョンは自動適用されるためUIは不要
  return null;
}
