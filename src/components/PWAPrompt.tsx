import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export function PWAPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
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

  const close = () => {
    setNeedRefresh(false);
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 max-w-md mx-auto">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-indigo-100 rounded-full">
            <RefreshCw size={20} className="text-indigo-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">
              新しいバージョンがあります
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              更新してアプリを最新版にしましょう
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => updateServiceWorker(true)}
                className="btn-primary flex-1 text-sm py-2"
              >
                更新する
              </button>
              <button
                onClick={close}
                className="btn-secondary text-sm py-2"
              >
                後で
              </button>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="閉じる"
            className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-all duration-150"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstallPrompt() {
  // beforeinstallprompt event handling would go here
  // For now, iOS users can manually add to home screen
  return null;
}
