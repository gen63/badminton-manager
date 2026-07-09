import { useCallback } from 'react';
import { useSessionWriter, type SessionWriterOptions } from './useSessionWriter';
import type { useToast } from './useToast';
import { SessionError } from '../lib/errorHandler';

type ToastApi = ReturnType<typeof useToast>;

/**
 * `useSessionWriter` を渡された toast に紐づけ、`onError` で transaction エラーを
 * 既定文言で表示する。`void writer.X(...)` で握りつぶされる失敗を可視化する用途。
 *
 * 呼び出し側は既存の `useToast()` 結果をそのまま渡す（toast キューが分離しないように）。
 *
 * 既定文言:
 *   - conflict: 「他のユーザーが更新しました」
 *   - not-found: 「セッションが見つかりません」
 *   - その他: 「同期に失敗しました」
 *
 * 個別ハンドラで try/catch したい場合は `useSessionWriter` を直接使う。
 */
function useToastErrorHandler(toast: ToastApi): NonNullable<SessionWriterOptions['onError']> {
  return useCallback(
    (err, op) => {
      const code = err instanceof SessionError ? err.code : undefined;
      const detail =
        code === 'conflict'
          ? '他のユーザーが更新しました'
          : code === 'not-found'
          ? 'セッションが見つかりません'
          : '同期に失敗しました';
      toast.error(`${detail} (${op})`);
    },
    [toast],
  );
}

/**
 * `useSessionWriter({ onError: useToastErrorHandler(toast) })` のショートハンド。
 * 既存の `toast` インスタンスを共有するため、呼び出し側で先に `useToast()` を取る。
 */
export function useSessionWriterWithToast(toast: ToastApi) {
  const onError = useToastErrorHandler(toast);
  return useSessionWriter({ onError });
}
