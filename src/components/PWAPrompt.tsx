import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export function PWAPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
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
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4 max-w-md mx-auto">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-100 rounded-full">
            <RefreshCw size={20} className="text-blue-500" />
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
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-full text-sm font-medium hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150"
              >
                更新する
              </button>
              <button
                onClick={close}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-full text-sm font-medium hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150"
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
