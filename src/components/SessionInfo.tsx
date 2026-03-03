/**
 * セッション情報表示コンポーネント
 * 
 * Phase 1: セッションID、管理者、参加者数などを表示
 */

import { Shield, Users, Calendar } from 'lucide-react';
import type { Session } from '../types/session';

interface SessionInfoProps {
  session: Session;
  isAdmin?: boolean;
}

export function SessionInfo({ session, isAdmin }: SessionInfoProps) {
  // Phase 1: セッション共有モードかどうか
  const isSharedSession = !!session.createdBy;
  
  if (!isSharedSession) {
    // Phase 0モード: 何も表示しない
    return null;
  }
  
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <Users size={20} className="text-white" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-gray-800 text-sm">
              共有セッション
            </h3>
            {isAdmin && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Shield size={12} />
                管理者
              </span>
            )}
          </div>
          
          <div className="space-y-1.5 text-xs text-gray-600">
            {/* セッションID */}
            {session.id && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">ID:</span>
                <span className="font-mono font-medium text-gray-700">
                  {session.id}
                </span>
              </div>
            )}
            
            {/* 管理者 */}
            {session.createdBy && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">管理者:</span>
                <span className="font-medium text-gray-700">
                  {session.createdBy}
                </span>
              </div>
            )}
            
            {/* 参加者数 */}
            {session.participants && session.participants.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">参加者:</span>
                <span className="font-medium text-gray-700">
                  {session.participants.length}人
                </span>
              </div>
            )}
            
            {/* 作成日時 */}
            {session.createdAt && (
              <div className="flex items-center gap-2">
                <Calendar size={12} className="text-gray-500" />
                <span className="text-gray-500">
                  {new Date(
                    typeof session.createdAt === 'string'
                      ? session.createdAt
                      : session.createdAt
                  ).toLocaleString('ja-JP', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
