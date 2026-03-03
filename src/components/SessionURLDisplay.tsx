/**
 * セッションURL表示・共有コンポーネント
 * 
 * Phase 1: セッション作成後にURLを表示・コピー
 */

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';

interface SessionURLDisplayProps {
  sessionId: string;
  onClose?: () => void;
}

export function SessionURLDisplay({ sessionId, onClose }: SessionURLDisplayProps) {
  const [copied, setCopied] = useState(false);
  
  // URLを生成（本番環境とローカル環境で切り替え）
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
  const sessionUrl = `${baseUrl}/session/${sessionId}`;
  
  // クリップボードにコピー
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // フォールバック: 選択状態にする
      const input = document.querySelector('input[value="' + sessionUrl + '"]') as HTMLInputElement;
      if (input) {
        input.select();
      }
    }
  };
  
  // Web Share API で共有（モバイル対応）
  const handleShare = async () => {
    if (!('share' in navigator)) {
      // 非対応ブラウザではコピー
      handleCopy();
      return;
    }
    
    try {
      await navigator.share({
        title: 'バドミントン練習セッション',
        text: `セッションに参加してください！\nセッションID: ${sessionId}`,
        url: sessionUrl
      });
    } catch (err) {
      // キャンセルされた場合は何もしない
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Failed to share:', err);
      }
    }
  };
  
  return (
    <div className="bg-white rounded-2xl shadow-md p-6">
      {/* ヘッダー */}
      <div className="text-center mb-6">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          セッション作成完了！
        </h2>
        <p className="text-sm text-gray-600">
          URLを参加者に共有してください
        </p>
      </div>
      
      {/* セッションID */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
        <p className="text-xs text-gray-600 mb-1">セッションID</p>
        <p className="text-2xl font-bold text-gray-800 tracking-wider">
          {sessionId}
        </p>
      </div>
      
      {/* URL表示 */}
      <div className="mb-4">
        <label className="block text-sm text-gray-600 mb-2">
          参加者用URL
        </label>
        <div className="relative">
          <input
            type="text"
            value={sessionUrl}
            readOnly
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-12
                     text-sm text-gray-700 select-all"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg
                     hover:bg-gray-200 active:bg-gray-300 transition-colors"
            title="URLをコピー"
          >
            {copied ? (
              <Check size={20} className="text-green-500" />
            ) : (
              <Copy size={20} className="text-gray-600" />
            )}
          </button>
        </div>
        {copied && (
          <p className="text-xs text-green-600 mt-1 text-center">
            ✓ URLをコピーしました
          </p>
        )}
      </div>
      
      {/* アクションボタン */}
      <div className="space-y-3">
        {/* 共有ボタン（モバイル対応） */}
        {'share' in navigator && (
          <button
            onClick={handleShare}
            className="w-full bg-blue-500 text-white rounded-full font-medium py-3 px-6
                     hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                     transition-all duration-150 flex items-center justify-center gap-2"
          >
            <Share2 size={20} />
            URLを共有
          </button>
        )}
        
        {/* コピーボタン（デスクトップ） */}
        {!('share' in navigator) && (
          <button
            onClick={handleCopy}
            className="w-full bg-blue-500 text-white rounded-full font-medium py-3 px-6
                     hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                     transition-all duration-150 flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check size={20} />
                コピー完了
              </>
            ) : (
              <>
                <Copy size={20} />
                URLをコピー
              </>
            )}
          </button>
        )}
        
        {/* メイン画面へ */}
        <button
          onClick={onClose}
          className="w-full bg-gray-100 text-gray-700 rounded-full font-medium py-3 px-6
                   hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98]
                   transition-all duration-150"
        >
          メイン画面へ
        </button>
      </div>
      
      {/* 注意事項 */}
      <div className="mt-6 p-4 bg-blue-50 rounded-xl">
        <p className="text-xs text-blue-800 leading-relaxed">
          💡 <strong>使い方:</strong><br />
          1. URLをLINEやメールで参加者に送信<br />
          2. 参加者がURLを開いて名前を選択<br />
          3. 全員がリアルタイムで同じ画面を共有
        </p>
      </div>
    </div>
  );
}
