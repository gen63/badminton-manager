import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { getSession, joinSession } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import type { Session } from '../types/session';
import { Loader2 } from 'lucide-react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const initializeSession = useSessionStore((state) => state.initialize);
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);

  useEffect(() => {
    if (!sessionId) {
      setError('セッションIDが指定されていません');
      setLoading(false);
      return;
    }

    getSession(sessionId)
      .then((data) => {
        if (!data) {
          setError('セッションが見つかりません');
        } else {
          setSession(data);
        }
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleJoin = async () => {
    if (!playerName.trim() || !sessionId || !session) return;

    setJoining(true);
    setError('');

    try {
      await joinSession(sessionId, playerName.trim());

      initializeSession({
        id: sessionId,
        config: session.config,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        createdBy: session.createdBy,
        participants: session.participants,
        status: session.status,
      });
      setCurrentUser(playerName.trim());

      navigate('/main');
    } catch (err) {
      setError(getErrorMessage(err));
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">セッション読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center p-4">
        <div className="card p-6 max-w-md w-full text-center">
          <h2 className="text-lg font-bold text-foreground mb-2">エラー</h2>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            トップに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* ヘッダー */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground mb-1">参加者入室</h1>
          <p className="text-xs text-muted-foreground">セッションID: {sessionId}</p>
        </div>

        {/* セッション情報 */}
        {session && (
          <div className="card p-4">
            <div className="space-y-2 text-sm">
              {session.createdBy && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">管理者</span>
                  <span className="font-medium">{session.createdBy}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">目標点数</span>
                <span className="font-medium">{session.config.targetScore}点</span>
              </div>
              {session.config.gym && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">体育館</span>
                  <span className="font-medium">{session.config.gym}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 名前入力 */}
        <div className="card p-4">
          <label className="label">あなたの名前</label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="名前を入力"
            className="input-field mb-2"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          <button
            onClick={handleJoin}
            disabled={!playerName.trim() || joining}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {joining && <Loader2 size={16} className="animate-spin" />}
            {joining ? '入室中...' : '入室する'}
          </button>
        </div>

        {/* 参加者リスト */}
        {session?.participants && session.participants.length > 0 && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-2">
              現在の参加者: {session.participants.length}人
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {session.participants.map((name) => (
                <span key={name} className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
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
