import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { getSession, joinSession, subscribeToGameState } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { requestNotificationPermission } from '../lib/notifications';
import { type Session } from '../types/session';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { Loader2, Plus, Copy, Check } from 'lucide-react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  
  // PWA検出
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (navigator as Navigator & { standalone?: boolean }).standalone;
  
  const [clipboardCopied, setClipboardCopied] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [additionalPlayers, setAdditionalPlayers] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!sessionId);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(() => sessionId ? '' : 'セッションIDが指定されていません');
  const [showForceConfirm, setShowForceConfirm] = useState(false);

  const initializeSession = useSessionStore((state) => state.initialize);
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);

  // Safari検出時にセッションIDをクリップボードにコピー（試行）
  useEffect(() => {
    if (!sessionId || isPWA) return;

    // Safari（非PWA）の場合、自動コピーを試行
    navigator.clipboard.writeText(sessionId)
      .then(() => {
        setClipboardCopied(true);
      })
      .catch(() => {
        // コピー失敗時も無視（手動ボタンで対応）
      });
  }, [sessionId, isPWA]);

  const handleManualCopy = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setClipboardCopied(true);
      // 2秒後に元に戻す
      setTimeout(() => setClipboardCopied(false), 2000);
    } catch {
      // フォールバック: 選択コピー
      const input = document.createElement('input');
      input.value = sessionId;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setClipboardCopied(true);
      // 2秒後に元に戻す
      setTimeout(() => setClipboardCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    getSession(sessionId)
      .then((data) => {
        if (!data) {
          setError('セッションが見つかりません');
        } else {
          setSession(data);
          // 登録済みプレイヤーがいなければ追加フォームを表示
          if (!data.registeredPlayers || data.registeredPlayers.length === 0) {
            setShowAddPlayer(true);
          }
        }
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // プレイヤー追加処理
  const handleAddPlayer = () => {
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;

    // 既存メンバーと重複チェック（入室済みかどうかに関係なく）
    const allPlayers = [
      ...(session?.registeredPlayers || []),
      ...additionalPlayers
    ];
    
    if (allPlayers.includes(trimmed)) {
      setError('その名前は既に登録されています');
      return;
    }

    setAdditionalPlayers([...additionalPlayers, trimmed]);
    setSelectedName(trimmed); // 追加したメンバーを自動選択
    setNewPlayerName('');
    setShowAddPlayer(false);
    setError('');
  };

  const handleJoin = async (force = false) => {
    if (!selectedName || !sessionId || !session) return;

    setJoining(true);
    setError('');

    try {
      const result = await joinSession(sessionId, selectedName, { force });
      
      // 既に参加している場合は確認ダイアログを表示
      if (result.alreadyJoined && !force) {
        setShowForceConfirm(true);
        setJoining(false);
        return;
      }

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
      setCurrentUser(selectedName);

      // Firestoreからゲーム状態を取得してローカルストアにセット
      const unsub = subscribeToGameState(sessionId, (gameState) => {
        if (gameState) {
          // Firebaseデータで上書き（古いlocalStorageデータをクリア）
          usePlayerStore.setState({ players: gameState.players });
          useGameStore.setState({
            courts: gameState.courts,
            matchHistory: gameState.matchHistory,
          });
          if (gameState.reservations) {
            useReservationStore.setState({ reservations: gameState.reservations });
          }
          unsub();
          // レンダリング完了を待ってからナビゲート
          setTimeout(() => navigate('/main'), 0);
        } else {
          // データがない場合（新規セッション）は空で初期化
          usePlayerStore.setState({ players: [] });
          useGameStore.setState({ courts: [], matchHistory: [] });
          useReservationStore.setState({ reservations: [] });
          unsub();
          // レンダリング完了を待ってからナビゲート
          setTimeout(() => navigate('/main'), 0);
        }
      });

      // タイムアウト: 5秒以内にデータ取れなかったらエラー
      setTimeout(() => {
        unsub();
        setError('セッションデータの取得に失敗しました。もう一度お試しください。');
        setJoining(false);
      }, 5000);
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

  // 参加済みの名前（グレーアウト表示用）
  const joinedNames = new Set(session?.participants || []);
  
  // 全ての選択可能なプレイヤー（既存 + 追加）※入室済みも含む
  const allRegisteredPlayers = session?.registeredPlayers || [];
  const allSelectablePlayers = [...allRegisteredPlayers, ...additionalPlayers];

  return (
    <div className="min-h-screen bg-app p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* Safari検出バナー（非PWA時のみ） */}
        {!isPWA && sessionId && (
          <div className="card p-4 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center">
                {clipboardCopied ? <Check size={20} className="text-white" /> : <Copy size={20} className="text-white" />}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-900 mb-1">
                  {clipboardCopied ? 'セッションIDをコピーしました' : 'PWAアプリで開くとスムーズ'}
                </h3>
                <p className="text-xs text-amber-800 mb-2">
                  ホーム画面の「バドミントン」アプリを開くと、自動的にこのセッションに参加できます。
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 bg-white/60 rounded px-2 py-1 text-center">
                    <span className="text-lg font-bold text-amber-900 tracking-wider">{sessionId}</span>
                  </div>
                  {!clipboardCopied && (
                    <button
                      onClick={handleManualCopy}
                      className="bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1 text-xs font-medium flex items-center gap-1"
                    >
                      <Copy size={14} />
                      コピー
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ヘッダー */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground mb-1">参加者入室</h1>
          <div className="flex items-center justify-center gap-2">
            <p className="text-xs text-muted-foreground">セッションID: {sessionId}</p>
            <button
              onClick={handleManualCopy}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="セッションIDをコピー"
            >
              {clipboardCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* 名前選択 */}
        <div className="card p-4">
          <label className="label">あなたの名前</label>

          {/* 登録済みプレイヤー + 追加プレイヤーから選択 */}
          {allSelectablePlayers.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {allSelectablePlayers.map((name) => {
                const isJoined = joinedNames.has(name);
                return (
                  <button
                    key={name}
                    onClick={() => setSelectedName(name)}
                    className={`relative select-button text-sm px-2 py-2 ${
                      selectedName === name
                        ? 'select-button-active'
                        : isJoined
                        ? 'bg-muted/50 text-muted-foreground border border-border opacity-60'
                        : 'select-button-inactive'
                    }`}
                  >
                    {selectedName === name && <span className="mr-1">✓</span>}
                    {name}
                    {isJoined && (
                      <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] px-1 py-0.5 rounded-full leading-none">
                        入室済み
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* リストにない名前で参加 */}
          <div className="border-t border-border pt-3 mb-3">
            <button
              onClick={() => setShowAddPlayer(!showAddPlayer)}
              className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1"
            >
              <Plus size={16} />
              リストにない名前で参加
            </button>

            {/* 追加フォーム（折りたたみ式） */}
            {showAddPlayer && (
              <div className="mt-3 bg-muted/30 rounded-xl p-3 flex gap-2">
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
                  className="flex-1 input-field"
                  autoFocus
                />
                <button
                  onClick={handleAddPlayer}
                  disabled={!newPlayerName.trim()}
                  className="bg-primary text-primary-foreground rounded-xl px-4 py-2 text-sm font-medium
                           hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98]
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-150 flex items-center justify-center"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

          <button
            onClick={() => handleJoin()}
            disabled={!selectedName || joining}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {joining && <Loader2 size={16} className="animate-spin" />}
            {joining ? '入室中...' : '入室する'}
          </button>
        </div>

        {/* 既に参加している場合の確認ダイアログ */}
        {showForceConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="card p-6 max-w-sm w-full">
              <h3 className="text-lg font-bold text-foreground mb-2">確認</h3>
              <p className="text-sm text-muted-foreground mb-4">
                「{selectedName}」は既に入室しています。
                <br />
                <span className="text-amber-600 font-medium">
                  この名前で入室すると、既に入室している人が退出します。
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowForceConfirm(false);
                    setError('');
                  }}
                  className="btn-secondary flex-1"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    setShowForceConfirm(false);
                    handleJoin(true);
                  }}
                  className="btn-primary flex-1"
                >
                  入室する
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
