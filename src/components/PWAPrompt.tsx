import { useRegisterSW } from 'virtual:pwa-register/react';

export function PWAPrompt() {
  useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
      if (r) {
        // 10分ごとにSWの更新をチェック
        setInterval(() => {
          r.update().catch(() => {});
        }, 10 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  // autoUpdateモード: 新バージョンは自動適用されるためUIは不要
  return null;
}
