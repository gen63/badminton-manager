/**
 * エラーハンドリングユーティリティ
 * 
 * Phase 1: Firebase エラーの処理
 */

export class SessionError extends Error {
  public code?: string;
  
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

/**
 * Firebase エラーをユーザーフレンドリーなメッセージに変換
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof SessionError) {
    return error.message;
  }
  
  // Firebase エラーコード
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: string }).code;
    
    switch (code) {
      case 'permission-denied':
        return 'アクセス権限がありません';
      case 'not-found':
        return 'セッションが見つかりません';
      case 'unavailable':
        return 'ネットワークエラー。接続を確認してください';
      case 'already-exists':
        return 'このセッションは既に存在します';
      case 'cancelled':
        return '操作がキャンセルされました';
      case 'deadline-exceeded':
        return 'タイムアウトしました。もう一度お試しください';
      default:
        return `エラーが発生しました (${code})`;
    }
  }
  
  // 一般的なエラー
  if (error instanceof Error) {
    return error.message;
  }
  
  return '予期しないエラーが発生しました';
}

/**
 * エラーをログに記録（開発時のデバッグ用）
 */
export function logError(error: unknown, context?: string): void {
  const prefix = context ? `[${context}]` : '';
  
  if (error instanceof Error) {
    console.error(`${prefix} Error:`, error.message);
    console.error('Stack:', error.stack);
  } else {
    console.error(`${prefix} Unknown error:`, error);
  }
}

/**
 * リトライ機能付きの非同期関数実行
 * 
 * @param fn - 実行する関数
 * @param maxRetries - 最大リトライ回数
 * @param delay - リトライ間隔（ミリ秒）
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: unknown;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < maxRetries) {
        // リトライ前に待機
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        console.log(`Retry ${i + 1}/${maxRetries}...`);
      }
    }
  }
  
  throw lastError;
}

/**
 * オフライン検出
 */
export function isOffline(): boolean {
  return !navigator.onLine;
}

/**
 * オフライン時のエラーメッセージ
 */
export function getOfflineMessage(): string {
  return 'オフラインです。インターネット接続を確認してください';
}
