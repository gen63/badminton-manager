/**
 * オンライン/オフライン状態表示コンポーネント
 * 
 * Phase 1: リアルタイム同期の接続状態を表示
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface OnlineStatusProps {
  isConnected?: boolean; // リアルタイム同期が接続されているか
}

export function OnlineStatus({ isConnected }: OnlineStatusProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  // オフラインの場合は警告を表示
  if (!isOnline) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
        <WifiOff size={20} className="text-red-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800">
            オフライン
          </p>
          <p className="text-xs text-red-600">
            インターネット接続を確認してください
          </p>
        </div>
      </div>
    );
  }
  
  // リアルタイム同期が有効な場合
  if (isConnected) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-2 flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <p className="text-xs text-green-700 font-medium">
          リアルタイム同期中
        </p>
      </div>
    );
  }
  
  // オンラインだがリアルタイム同期が無効
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-2 flex items-center gap-2">
      <Wifi size={16} className="text-gray-500" />
      <p className="text-xs text-gray-600">
        オンライン
      </p>
    </div>
  );
}
