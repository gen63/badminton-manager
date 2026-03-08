import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';

interface SessionURLDisplayProps {
  sessionId: string;
  onClose?: () => void;
}

export function SessionURLDisplay({ sessionId, onClose }: SessionURLDisplayProps) {
  const [copied, setCopied] = useState(false);

  const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
  const sessionUrl = `${baseUrl}/session/${sessionId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.querySelector(`input[value="${sessionUrl}"]`) as HTMLInputElement;
      input?.select();
    }
  };

  const handleShare = async () => {
    if (!('share' in navigator)) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: 'バドミントン練習セッション',
        text: `セッションに参加してください！\nセッションID: ${sessionId}`,
        url: sessionUrl,
      });
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Failed to share:', err);
      }
    }
  };

  return (
    <div className="card p-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-foreground mb-2">セッション作成完了</h2>
        <p className="text-sm text-muted-foreground">URLを参加者に共有してください</p>
      </div>

      {/* セッションID */}
      <div className="bg-muted rounded-xl p-4 mb-4 text-center">
        <p className="text-xs text-muted-foreground mb-1">セッションID</p>
        <p className="text-2xl font-bold text-foreground tracking-wider">{sessionId}</p>
      </div>

      {/* URL表示 */}
      <div className="mb-4">
        <label className="label">参加者用URL</label>
        <div className="relative">
          <input
            type="text"
            value={sessionUrl}
            readOnly
            className="input-field pr-12 text-sm"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            className="absolute right-2 top-1/2 -translate-y-1/2 icon-btn"
            title="URLをコピー"
          >
            {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
          </button>
        </div>
        {copied && (
          <p className="text-xs text-green-600 mt-1 text-center">URLをコピーしました</p>
        )}
      </div>

      {/* アクションボタン */}
      <div className="space-y-3">
        {'share' in navigator ? (
          <button onClick={handleShare} className="btn-primary w-full flex items-center justify-center gap-2">
            <Share2 size={18} />
            URLを共有
          </button>
        ) : (
          <button onClick={handleCopy} className="btn-primary w-full flex items-center justify-center gap-2">
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'コピー完了' : 'URLをコピー'}
          </button>
        )}

        <button onClick={onClose} className="btn-secondary w-full">
          メイン画面へ
        </button>
      </div>

      {/* 使い方 */}
      <div className="mt-6 p-3 bg-blue-50 rounded-xl">
        <p className="text-xs text-blue-800 leading-relaxed">
          <strong>使い方:</strong> URLをLINEやメールで参加者に送信 → 参加者がURLを開いて名前を入力 → リアルタイムで同じ画面を共有
        </p>
      </div>
    </div>
  );
}
