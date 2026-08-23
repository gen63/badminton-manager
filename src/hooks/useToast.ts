import { useMemo, useState, useCallback } from 'react';
import type { ToastAction, ToastType } from '../components/Toast';

interface ToastState {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration?: number, action?: ToastAction) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, type, duration, action }]);
    },
    [],
  );

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // TOAST1 fix: success/error/info/warning を memoize しないと、戻り値が毎
  // レンダー新オブジェクトになる。useToastErrorHandler が toast を dep にする
  // ので、毎レンダー writer の callback 全部が再生成されていた。
  const success = useCallback((message: string, duration?: number) => showToast(message, 'success', duration), [showToast]);
  const error = useCallback((message: string, duration?: number) => showToast(message, 'error', duration), [showToast]);
  const info = useCallback((message: string, duration?: number) => showToast(message, 'info', duration), [showToast]);
  const warning = useCallback((message: string, duration?: number) => showToast(message, 'warning', duration), [showToast]);

  return useMemo(
    () => ({ toasts, showToast, hideToast, success, error, info, warning }),
    [toasts, showToast, hideToast, success, error, info, warning],
  );
}
