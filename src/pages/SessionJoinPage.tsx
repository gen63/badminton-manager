/**
 * 参加者選択画面（S02）
 * 
 * Phase 1: セッション共有
 * URL経由で入室した参加者が自分の名前を選択する画面
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { getSession, joinSession } from '../services/sessionService';
import type { Session } from '../types/session';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<Session | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  
  const initializeSession = useSessionStore((state) => state.initialize);
  const setPlayers = usePlayerStore((state) => state.setPlayers);
  
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
        console.error('Failed to load session:', err);
        setError('セッション読み込みエラー');
        setLoading(false);
      }
    }
    
    loadSession();
  }, [sessionId]);
  
  // 入室処理
  const handleJoin = async () => {
    if (!selectedPlayer || !sessionId || !session) return;
    
    try {
      // Firestore に参加者登録
      await joinSession(sessionId, selectedPlayer);
      
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
      
      // プレイヤーリストを設定（Phase 0のデータ構造を流用）
      // TODO: Firestoreから最新の状態を取得
      
      // メイン画面へ遷移
      navigate('/main');
    } catch (err) {
      console.error('Failed to join session:', err);
      setError('入室に失敗しました');
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
  
  // プレイヤーリストを生成（セッション作成時の参加者リスト）
  const players = session.config.practiceDate ? [] : []; // TODO: 実装
  
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
          
          {/* TODO: プレイヤーリストから選択 */}
          <div className="space-y-2 mb-4">
            <input
              type="text"
              value={selectedPlayer}
              onChange={(e) => setSelectedPlayer(e.target.value)}
              placeholder="名前を入力"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3
                       focus:ring-2 focus:ring-blue-300 focus:border-transparent
                       text-base"
            />
            <p className="text-xs text-gray-500">
              ※ セッション作成時に登録された名前を入力してください
            </p>
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
