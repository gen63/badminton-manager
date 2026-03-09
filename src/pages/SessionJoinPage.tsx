/**
 * 参加者選択画面（S02）
 * 
 * Phase 1: セッション共有
 * URL経由で入室した参加者が自分の名前を選択する画面
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { getSession, joinSession } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import type { Session } from '../types/session';
import { Plus } from 'lucide-react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<Session | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [newPlayerName, setNewPlayerName] = useState<string>('');
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [additionalPlayers, setAdditionalPlayers] = useState<string[]>([]);
  
  const initializeSession = useSessionStore((state) => state.initialize);
  
  // セッション情報を取得
  useEffect(() => {
    if (!sessionId) {
      setError('セッションIDが指定されていません');
      setLoading(false);
      return;
    }
    
    async function loadSession() {
      try {
        const data = await getSession(sessionId!);
        
        if (!data) {
          setError('セッションが見つかりません');
          setLoading(false);
          return;
        }
        
        setSession(data);
        setLoading(false);
      } catch (err) {
        const message = getErrorMessage(err);
        setError(message);
        setLoading(false);
      }
    }
    
    loadSession();
  }, [sessionId]);
  
  // プレイヤー追加処理
  const handleAddPlayer = () => {
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;
    
    // 既存メンバーと重複チェック
    const allPlayers = [...(session?.participants || []), ...additionalPlayers];
    if (allPlayers.includes(trimmed)) {
      setError('その名前は既に登録されています');
      return;
    }
    
    setAdditionalPlayers([...additionalPlayers, trimmed]);
    setSelectedPlayer(trimmed); // 追加したメンバーを自動選択
    setNewPlayerName('');
    setShowAddPlayer(false);
    setError('');
  };
  
  // 入室処理
  const handleJoin = async () => {
    if (!selectedPlayer || !sessionId || !session) return;
    
    try {
      // バリデーション
      if (selectedPlayer.trim() === '') {
        setError('名前を入力してください');
        return;
      }
      
      // Firestore に参加者登録
      await joinSession(sessionId, selectedPlayer.trim());
      
      // ローカル状態を初期化
      initializeSession({
        id: sessionId,
        config: session.config,
        createdAt: typeof session.createdAt === 'string' 
          ? new Date(session.createdAt).getTime() 
          : session.createdAt,
        updatedAt: Date.now(),
        createdBy: session.createdBy,
        participants: session.participants,
        status: session.status
      });
      
      // 現在のユーザーを設定
      useSessionStore.getState().setCurrentUser(selectedPlayer.trim());
      
      // プレイヤーリストを設定（Phase 0のデータ構造を流用）
      // TODO: Firestoreから最新の状態を取得
      
      // メイン画面へ遷移
      navigate('/main');
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">セッション読み込み中...</p>
        </div>
      </div>
    );
  }
  
  if (error || !session) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-md p-6 text-center">
          <div className="text-4xl mb-4">❌</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            エラー
          </h2>
          <p className="text-gray-600 mb-6">
            {error || 'セッションが見つかりません'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-blue-500 text-white rounded-full font-medium py-3 px-6
                     hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                     transition-all duration-150"
          >
            トップに戻る
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            🏸 参加者選択
          </h1>
          <p className="text-sm text-gray-600">
            あなたの名前を選択してください
          </p>
          <p className="text-xs text-gray-500 mt-2">
            セッションID: {sessionId}
          </p>
        </div>
        
        {/* セッション情報カード */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">管理者</span>
              <span className="font-medium text-gray-800">
                {session.createdBy || '未設定'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">コート数</span>
              <span className="font-medium text-gray-800">
                {session.config.courtCount}面
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">目標点数</span>
              <span className="font-medium text-gray-800">
                {session.config.targetScore}点
              </span>
            </div>
          </div>
        </div>
        
        {/* プレイヤー選択カード */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            あなたの名前
          </h2>
          
          {/* 既存メンバー + 追加メンバーのボタン表示 */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[...(session.participants || []), ...additionalPlayers].map((name) => (
              <button
                key={name}
                onClick={() => setSelectedPlayer(name)}
                className={`px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                  selectedPlayer === name
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          
          {/* リストにない名前で参加 */}
          <div className="border-t border-gray-200 pt-4">
            <button
              onClick={() => setShowAddPlayer(!showAddPlayer)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus size={16} />
              リストにない名前で参加
            </button>
            
            {/* 追加フォーム（折りたたみ式） */}
            {showAddPlayer && (
              <div className="mt-3 bg-gray-50 rounded-xl p-3 flex gap-2">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPlayerName.trim()) {
                      handleAddPlayer();
                    }
                  }}
                  placeholder="名前を入力"
                  className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2
                           focus:ring-2 focus:ring-blue-300 focus:border-transparent
                           text-sm"
                  autoFocus
                />
                <button
                  onClick={handleAddPlayer}
                  disabled={!newPlayerName.trim()}
                  className="bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-medium
                           hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-150 flex items-center justify-center"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* 入室ボタン */}
        <button
          onClick={handleJoin}
          disabled={!selectedPlayer}
          className="w-full bg-blue-500 text-white rounded-full font-medium py-4 px-6
                   hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98]
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all duration-150 shadow-md"
        >
          入室する
        </button>
        
        {/* 参加者数表示 */}
        {session.participants && session.participants.length > 0 && (
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              現在の参加者: {session.participants.length}人
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {session.participants.map((name) => (
                <span 
                  key={name}
                  className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
