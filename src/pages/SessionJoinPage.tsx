import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { getSession, joinSession, subscribeToGameState } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { requestNotificationPermission } from '../lib/notifications';
import type { Session } from '../types/session';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { Loader2, UserPlus } from 'lucide-react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [customName, setCustomName] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
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
          // 登録済みプレイヤーがいなければ直接入力モード
          if (!data.registeredPlayers || data.registeredPlayers.length === 0) {
            setIsCustomMode(true);
          }
        }
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const playerName = isCustomMode ? customName.trim() : selectedName;

  const handleJoin = async () => {
    if (!playerName || !sessionId || !session) return;

    setJoining(true);
    setError('');

    try {
      await joinSession(sessionId, playerName);
      requestNotificationPermission();

      initializeSession({
        id: sessionId,
        config: session.config,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        createdBy: session.createdBy,
        participants: session.participants,
        registeredPlayers: session.registeredPlayers,
        status: session.status,
      });
      setCurrentUser(playerName);

      // Firestoreからゲーム状態を取得してローカルストアにセット
      // （古いlocalStorageデータを上書き）
      const unsub = subscribeToGameState(sessionId, (gameState) => {
        if (gameState) {
          usePlayerStore.setState({ players: gameState.players });
          useGameStore.setState({
            courts: gameState.courts,
            matchHistory: gameState.matchHistory,
          });
          if (gameState.reservations) {
            useReservationStore.setState({ reservations: gameState.reservations });
          }
        }
        unsub();
        navigate('/main');
      });

      // タイムアウト: 3秒以内にデータ取れなくても遷移
      setTimeout(() => {
        unsub();
        navigate('/main');
      }, 3000);
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

  // 参加済みの名前（選択肢から除外）
  const joinedNames = new Set(session?.participants || []);
  const availablePlayers = (session?.registeredPlayers || []).filter(
    (name) => !joinedNames.has(name),
  );

  return (
    <div className="min-h-screen bg-app p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* ヘッダー */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground mb-1">参加者入室</h1>
          <p className="text-xs text-muted-foreground">セッションID: {sessionId}</p>
        </div>

        {/* 名前選択 */}
        <div className="card p-4">
          <label className="label">あなたの名前</label>

          {!isCustomMode && availablePlayers.length > 0 ? (
            <>
              {/* 登録済みプレイヤーから選択 */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {availablePlayers.map((name) => (
                  <button
                    key={name}
                    onClick={() => setSelectedName(name)}
                    className={`select-button text-sm px-2 py-2 ${
                      selectedName === name
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {selectedName === name && <span className="mr-1">✓</span>}
                    {name}
                  </button>
                ))}
              </div>

              {/* リストにない場合 */}
              <button
                onClick={() => {
                  setIsCustomMode(true);
                  setSelectedName('');
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <UserPlus size={14} />
                リストにない名前で参加
              </button>
            </>
          ) : (
            <>
              {/* 直接入力 */}
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="名前を入力"
                className="input-field mb-2"
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
              {session?.registeredPlayers && session.registeredPlayers.length > 0 && (
                <button
                  onClick={() => {
                    setIsCustomMode(false);
                    setCustomName('');
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 mb-2 block"
                >
                  リストから選択に戻る
                </button>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={!playerName || joining}
            className="btn-primary w-full flex items-center justify-center gap-2 mt-3"
          >
            {joining && <Loader2 size={16} className="animate-spin" />}
            {joining ? '入室中...' : '入室する'}
          </button>
        </div>


      </div>
    </div>
  );
}
