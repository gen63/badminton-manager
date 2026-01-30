import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle className="text-green-500" size={20} />,
    error: <XCircle className="text-red-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
    warning: <AlertTriangle className="text-yellow-500" size={20} />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
    warning: 'bg-yellow-50 border-yellow-200',
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-4 left-4 right-4 z-50 transition-all duration-200 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg max-w-md mx-auto ${bgColors[type]}`}
      >
        {icons[type]}
        <p className="flex-1 text-sm font-medium text-gray-800">{message}</p>
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
          aria-label="閉じる"
          className="p-2 -mr-1 text-gray-500 hover:text-gray-700 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
