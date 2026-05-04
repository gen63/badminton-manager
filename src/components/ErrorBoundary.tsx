import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ルート ErrorBoundary。未捕捉の React 例外で画面が真っ白になるのを防ぐ。
 *
 * 復旧手段は「リロード」ボタンのみ。zustand ストアは Firestore から復元される
 * ため失われない（settingsStore は localStorage から復元される）。
 *
 * `componentDidCatch` で console と localStorage に記録するだけで、外部の
 * クラッシュレポーティングサービスは未連携。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info);
    try {
      const last = {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        at: new Date().toISOString(),
      };
      localStorage.setItem('badminton-last-error', JSON.stringify(last));
    } catch {
      /* localStorage が無効でも握り潰す */
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-app flex items-center justify-center p-4">
          <div className="max-w-md w-full card p-6 space-y-4">
            <h1 className="text-lg font-bold text-destructive">予期しないエラーが発生しました</h1>
            <p className="text-sm text-muted-foreground">
              アプリの状態を復旧するためにリロードしてください。
              繰り返し発生する場合は管理者に連絡してください。
            </p>
            {this.state.error.message && (
              <pre className="bg-muted text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="btn-primary w-full min-h-[44px]"
            >
              リロード
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
