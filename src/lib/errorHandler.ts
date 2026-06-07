export class SessionError extends Error {
  public code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof SessionError) {
    return error.message;
  }

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
      case 'deadline-exceeded':
        return 'タイムアウトしました。もう一度お試しください';
      default:
        return `エラーが発生しました (${code})`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '予期しないエラーが発生しました';
}
