import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { copyToClipboard } from '../lib/utils';

interface SessionURLDisplayProps {
  sessionId: string;
  onClose?: () => void;
}

export function SessionURLDisplay({ sessionId, onClose }: SessionURLDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

  const baseUrl = window.location.origin + '/badminton-manager';
  const sessionUrl = `${baseUrl}/session/${sessionId}`;

  const handleCopyId = async () => {
    await copyToClipboard(sessionId);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 2000);
  };

  const handleCopy = async () => {
    await copyToClipboard(sessionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div className="bg-muted rounded-xl p-4 mb-4">
        <p className="text-xs text-muted-foreground mb-1 text-center">セッションID</p>
        <div className="flex items-center justify-center gap-2">
          <p className="text-2xl font-bold text-foreground tracking-wider">{sessionId}</p>
          <button
            onClick={handleCopyId}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="セッションIDをコピー"
          >
            {idCopied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
          </button>
        </div>
        {idCopied && (
          <p className="text-xs text-green-600 mt-1 text-center">セッションIDをコピーしました</p>
        )}
      </div>

      {/* QRコード */}
      <div className="flex justify-center mb-4">
        <div className="bg-white p-3 rounded-xl shadow-sm border border-border">
          <QRCodeSVG 
            value={sessionUrl}
            size={180}
            level="M"
            includeMargin={false}
          />
        </div>
      </div>

      {/* URL表示 */}
      <div className="mb-4">
        <label className="label">参加者用URL</label>
        <input
          type="text"
          value={sessionUrl}
          readOnly
          className="input-field text-sm"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        {copied && (
          <p className="text-xs text-green-600 mt-1 text-center">URLをコピーしました</p>
        )}
      </div>

      {/* アクションボタン */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <button 
            onClick={handleCopy} 
            className="flex-1 btn-primary flex items-center justify-center gap-2"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'コピー完了' : 'URLをコピー'}
          </button>
          {'share' in navigator && (
            <button 
              onClick={handleShare} 
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              <Share2 size={18} />
              URLを共有
            </button>
          )}
        </div>

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
