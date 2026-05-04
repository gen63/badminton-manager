import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { clearPresence, getSession, joinSession, leaveSession, subscribeToSession } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { PlayerAddInput } from '../components/PlayerAddInput';
import { requestNotificationPermission } from '../lib/notifications';
import { clearAppBadge } from '../lib/badge';
import { copyToClipboard } from '../lib/utils';
import { type Session } from '../types/session';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useUndoStore } from '../stores/undoStore';
import { Loader2, Plus, Copy, Check, Link, ChevronDown } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  
  // PWA検出
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (navigator as Navigator & { standalone?: boolean }).standalone;
  
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const sessionUrl = sessionId
    ? `${window.location.origin}/badminton-manager/session/${sessionId}`
    : '';

  const [session, setSession] = useState<Session | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [selectedGender, setSelectedGender] = useState<'M' | 'F' | undefined>(undefined);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [additionalPlayers, setAdditionalPlayers] = useState<{ name: string; gender: 'M' | 'F' }[]>([]);
  const [loading, setLoading] = useState(!!sessionId);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(() => sessionId ? '' : 'セッションIDが指定されていません');
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [showJoinedMembers, setShowJoinedMembers] = useState(false);

  const initializeSession = useSessionStore((state) => state.initialize);
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);

  // PWAバッジをクリア（セッション参加前）
  useEffect(() => {
    clearAppBadge();
  }, []);

  // Safari検出時にセッションIDをクリップボードにコピー（試行）
  useEffect(() => {
    if (!sessionId || isPWA) return;

    copyToClipboard(sessionId).then((ok) => {
      if (ok) {
        setClipboardCopied(true);
        setTimeout(() => setClipboardCopied(false), 3000);
      }
    });
  }, [sessionId, isPWA]);

  const handleManualCopy = async () => {
    if (!sessionId) return;
    const ok = await copyToClipboard(sessionId);
    if (ok) {
      setClipboardCopied(true);
      setIdCopied(true);
      setTimeout(() => setClipboardCopied(false), 2000);
      setTimeout(() => setIdCopied(false), 1000);
    }
  };

  const handleCopyUrl = async () => {
    if (!sessionUrl) return;
    const ok = await copyToClipboard(sessionUrl);
    if (ok) {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1000);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    // 初回取得
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

    // リアルタイム監視（メンバー追加・名前変更をリアルタイムに反映）
    const unsub = subscribeToSession(sessionId, (data) => {
      if (data) {
        setSession(data);
      }
    });

    return unsub;
  }, [sessionId]);

  // プレイヤー追加処理
  const handleAddPlayer = (name: string, gender: 'M' | 'F') => {
    // 既存メンバーと重複チェック（入室済みかどうかに関係なく）
    const allNames = [
      ...(session?.registeredPlayers || []),
      ...additionalPlayers.map((p) => p.name),
    ];

    if (allNames.includes(name)) {
      setError('その名前は既に登録されています');
      return;
    }

    setAdditionalPlayers([...additionalPlayers, { name, gender }]);
    setSelectedName(name); // 追加したメンバーを自動選択
    setSelectedGender(gender);
    setShowAddPlayer(false);
    setError('');
  };

  const handleJoin = async (force = false) => {
    if (!selectedName || !sessionId || !session) return;

    setJoining(true);
    setError('');

    // 別の共有セッションに居る場合は離脱（同一セッションへの再入室は除く）
    const previousSession = useSessionStore.getState().session;
    const previousUser = useSessionStore.getState().currentUser;
    const isSameOnlineSession =
      !!previousSession?.id &&
      !!previousSession.createdBy &&
      previousSession.id === sessionId;
    if (
      previousSession?.id &&
      previousSession.id !== sessionId &&
      previousSession.createdBy
    ) {
      if (previousUser) {
        void Promise.allSettled([
          leaveSession(previousSession.id, previousUser),
          clearPresence(previousSession.id, previousUser),
        ]);
      }
    }

    try {
      const result = await joinSession(sessionId, selectedName, { force, gender: selectedGender });

      // 既に参加している場合は確認ダイアログを表示
      if (result.isAlreadyJoined && !force) {
        setShowForceConfirm(true);
        setJoining(false);
        return;
      }

      requestNotificationPermission();

      // 同一オンラインセッションへの再入室時はローカル状態を保持する。
      // クリアすると useFirebaseSync の subscriber が schedulePush を発火し、
      // subscribeToGameState による復元より先に push が動くと
      // mergeMatchHistory(base=[matches], local=[], remote=[matches]) が
      // 「local が削除した」と解釈して Firestore の matchHistory をワイプしてしまう。
      // 別セッションへの切替・新規入室・ローカルモードからの遷移時は従来通りクリアする。
      if (!isSameOnlineSession) {
        usePlayerStore.getState().clearPlayers();
        useGameStore.getState().clearHistory();
        useReservationStore.getState().clearReservations();
        useAccountingStore.getState().clearRecords();
        useUndoStore.getState().clearAll();
      }

      initializeSession({
        id: sessionId,
        config: session.config,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        createdBy: result.newCreator ?? session.createdBy,
        participants: session.participants,
        registeredPlayers: session.registeredPlayers,
        status: session.status,
      });
      setCurrentUser(selectedName);

      // App level の useFirebaseSync が session/gameState を購読する（H8 修正で
      // 個別 subscribeToGameState は撤去）。/main マウント後に onSnapshot で
      // ストアが埋まる。
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

  // 参加済みの名前（グレーアウト表示用）
  const joinedNames = new Set(session?.participants || []);
  
  // 全ての選択可能なプレイヤー（既存 + 追加）※入室済みも含む
  // registeredPlayersに既に含まれるadditionalPlayersを除外（リアルタイム同期で重複防止）
  const allRegisteredPlayers = session?.registeredPlayers || [];
  const registeredSet = new Set(allRegisteredPlayers);
  const additionalPlayerNames = additionalPlayers
    .filter((p) => !registeredSet.has(p.name))
    .map((p) => p.name);
  const allSelectablePlayers = [...allRegisteredPlayers, ...additionalPlayerNames];
  const notJoinedPlayers = allSelectablePlayers.filter((name) => !joinedNames.has(name));
  const joinedPlayers = allSelectablePlayers.filter((name) => joinedNames.has(name));
  // 選択中の名前が入室済みリストにある場合はアコーディオンを自動展開
  const isJoinedExpanded = showJoinedMembers || (!!selectedName && joinedNames.has(selectedName));

  return (
    <div className="min-h-screen bg-app p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* ヘッダー */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">参加者入室</h1>
        </div>

        {/* PWA案内バナー（非PWA時のみ） */}
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
                  <button
                    onClick={handleManualCopy}
                    className="flex-1 bg-white/60 hover:bg-white/80 rounded px-2 py-1 text-center transition-colors active:scale-95"
                  >
                    <span className="text-lg font-bold text-amber-900 tracking-wider">{sessionId}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 名前選択 */}
        <div className="card p-4">
          <label className="label">あなたの名前</label>

          {/* 未入室プレイヤーから選択 */}
          {notJoinedPlayers.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {notJoinedPlayers.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setSelectedName(name);
                    const additional = additionalPlayers.find((p) => p.name === name);
                    setSelectedGender(additional?.gender);
                  }}
                  className={`relative select-button text-sm px-2 py-2 ${
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
          )}

          {/* 入室済みメンバー（アコーディオン） */}
          {joinedPlayers.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setShowJoinedMembers(!isJoinedExpanded)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${isJoinedExpanded ? 'rotate-180' : ''}`}
                />
                入室済み（{joinedPlayers.length}名）
              </button>
              {isJoinedExpanded && (
                <div className="grid grid-cols-3 gap-2">
                  {joinedPlayers.map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        setSelectedName(name);
                        const additional = additionalPlayers.find((p) => p.name === name);
                        setSelectedGender(additional?.gender);
                      }}
                      className={`relative select-button text-sm px-2 py-2 ${
                        selectedName === name
                          ? 'select-button-active'
                          : 'bg-muted/50 text-muted-foreground border border-border opacity-60'
                      }`}
                    >
                      {selectedName === name && <span className="mr-1">✓</span>}
                      {name}
                      <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] px-1 py-0.5 rounded-full leading-none">
                        入室済み
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
              <div className="mt-3 bg-muted/30 rounded-xl p-3">
                <PlayerAddInput
                  onAdd={(name, gender) => handleAddPlayer(name, gender)}
                  placeholder="ニックネームを入力 例：げん"
                />
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

        {/* 他の参加者に共有（アコーディオン） */}
        {sessionId && (
          <div className="card overflow-hidden">
            <button
              onClick={() => setShowQR(!showQR)}
              className="w-full flex items-center justify-between p-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>他の参加者に共有</span>
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${showQR ? 'rotate-180' : ''}`}
              />
            </button>
            {showQR && (
              <div className="px-4 pb-4 space-y-3">
                <div className="text-center">
                  {isPWA && (
                    <p
                      onClick={handleManualCopy}
                      className="text-xs text-muted-foreground mb-2 cursor-pointer active:opacity-60"
                    >
                      {idCopied
                        ? <span className="text-green-600">セッションIDをコピーしました</span>
                        : <>セッションID: <span className="font-medium">{sessionId}</span></>
                      }
                    </p>
                  )}
                  <button
                    onClick={handleCopyUrl}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    {urlCopied ? <Check size={14} className="text-green-500" /> : <Link size={14} />}
                    {urlCopied ? 'URLをコピーしました' : 'セッションURLをコピー'}
                  </button>
                </div>
                <div className="flex justify-center">
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-border">
                    <QRCodeSVG
                      value={sessionUrl}
                      size={180}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  このQRコードを読み取ると参加できます
                </p>
              </div>
            )}
          </div>
        )}

        {/* 既に参加している場合の確認ダイアログ */}
        {showForceConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="card p-6 max-w-sm w-full">
              <h3 className="text-lg font-bold text-foreground mb-2">再入室の確認</h3>
              <p className="text-sm text-muted-foreground mb-4">
                「{selectedName}」は別のブラウザ・端末で入室中です。
                <br />
                <span className="text-amber-600 font-medium">
                  こちらから入室し直しますか？
                </span>
                <br />
                <span className="text-xs text-muted-foreground">
                  ※以前のブラウザ・端末でのセッションは自動的に切断されます
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
