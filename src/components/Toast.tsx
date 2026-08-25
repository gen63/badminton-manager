import { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/** トースト内に出す1アクション（例: 試合終了の「取り消す」） */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
  /**
   * 取り消しなど、その場で打ち返せる操作。押すとトーストは閉じる。
   * 「やってしまった」と気づくまでに読む時間が要るので、付けるときは
   * `duration` も長めにすること。
   */
  action?: ToastAction;
}

export function Toast({ message, type, onClose, duration = 3000, action }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  // TOAST2 fix: 自動クローズのタイマーを onClose の識別子に依存させない。
  // 呼び出し側（MainPage）は `onClose={() => toast.hideToast(t.id)}` を毎レンダー
  // 作り直すため、依存に入れると **親が再レンダリングするたびにタイマーが振り出しに
  // 戻り**、トーストが時間で消えなくなる（MainPage は呼び出し判定の 10 秒
  // インターバルや onSnapshot 受信で頻繁に再レンダリングする）。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setIsVisible(false);
      // フェードアウト（200ms）を見せてから親のリストから消す
      fadeTimer = setTimeout(() => onCloseRef.current(), 300);
    }, duration);

    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, [duration]);

  const icons = {
    success: <CheckCircle className="text-green-500" size={20} />,
    error: <XCircle className="text-red-500" size={20} />,
    info: <Info className="text-indigo-500" size={20} />,
    warning: <AlertTriangle className="text-yellow-500" size={20} />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-indigo-50 border-indigo-200',
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
        <p className="flex-1 text-sm font-medium text-foreground">{message}</p>
        {action && (
          <button
            onClick={() => {
              action.onClick();
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            className="px-3 min-h-[44px] shrink-0 font-bold text-sm text-indigo-700 underline underline-offset-2 hover:text-indigo-900 active:scale-95 transition-all"
          >
            {action.label}
          </button>
        )}
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
          aria-label="閉じる"
          className="p-2 -mr-1 text-muted-foreground hover:text-gray-700 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
