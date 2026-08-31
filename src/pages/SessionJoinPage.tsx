import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { clearPresence, getSession, joinSession, leaveSession, subscribeToSession } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { isValidSessionId } from '../lib/inputValidation';
import { PlayerAddInput } from '../components/PlayerAddInput';
import { requestNotificationPermission } from '../lib/notifications';
import { clearAppBadge } from '../lib/badge';
import { type Session } from '../types/session';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useReservationStore } from '../stores/reservationStore';
import { usePairPreferenceStore } from '../stores/pairPreferenceStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useUndoStore } from '../stores/undoStore';
import { useDevMode } from '../hooks/useDevMode';
import { Loader2, Plus, ChevronDown, EyeOff } from 'lucide-react';

export function SessionJoinPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const devMode = useDevMode();

  const [session, setSession] = useState<Session | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [selectedGender, setSelectedGender] = useState<'M' | 'F' | undefined>(undefined);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [additionalPlayers, setAdditionalPlayers] = useState<{ name: string; gender: 'M' | 'F' }[]>([]);
  const [loading, setLoading] = useState(!!sessionId);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(() => sessionId ? '' : 'セッションIDが指定されていません');
  // アコーディオンの開閉。null = ユーザー未操作（自動判定に委ねる）。
  // 未操作なら全員入室済み or 選択中の名前が入室済みの場合に自動で開き、
  // それ以外は既定で閉じる。ユーザーが一度タップしたらその選択（override）を優先する。
  const [showJoinedOverride, setShowJoinedOverride] = useState<boolean | null>(null);

  const initializeSession = useSessionStore((state) => state.initialize);
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);

  // PWAバッジをクリア（セッション参加前）
  useEffect(() => {
    clearAppBadge();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    // SEC3: 不正な形式の sessionId は早期エラー（任意 ID で getSession を叩かない）
    if (!isValidSessionId(sessionId)) {
      // エフェクト内の同期 setState を避けるため microtask で遅延
      queueMicrotask(() => {
        setError('セッションIDの形式が正しくありません');
        setLoading(false);
      });
      return;
    }

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
          // Phase B (2026-05-06): session 自体は persist しないが、`currentUser`
          // は残しているため、その名前が登録済みプレイヤーに含まれていれば
          // 自動選択して再入室の手間を省く。
          const persistedUser = useSessionStore.getState().currentUser;
          if (
            persistedUser &&
            data.registeredPlayers?.includes(persistedUser)
          ) {
            setSelectedName(persistedUser);
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

  const handleJoin = async () => {
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
      const result = await joinSession(sessionId, selectedName, { gender: selectedGender });

      requestNotificationPermission();

      // 同一セッションへの再入室時はローカル状態を保持する。
      // クリアすると useFirebaseSync の subscriber が schedulePush を発火し、
      // subscribeToGameState による復元より先に push が動くと
      // mergeMatchHistory(base=[matches], local=[], remote=[matches]) が
      // 「local が削除した」と解釈して Firestore の matchHistory をワイプしてしまう。
      // 別セッションへの切替・新規入室時は従来通りクリアする。
      if (!isSameOnlineSession) {
        usePlayerStore.getState().clearPlayers();
        useGameStore.getState().clearHistory();
        useReservationStore.getState().clearReservations();
        usePairPreferenceStore.getState().clearPairPreferences();
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
      // 個別 subscribeToGameState は撤去）。CON4: 初回 onSnapshot で
      // isGameStateLoaded=true になるまで待ってから /main へ navigate
      // するとデータ未到着の空 UI を見せなくて済む。
      // JOIN2 fix: polling 前に明示的に false にしないと、前セッションでの
      // true 値を読んで即 navigate されてしまう（useFirebaseSync の effect 再実行が
      // この同期 path より遅い場合がある）。
      useSyncStatusStore.getState().setGameStateLoaded(false);
      const startedAt = Date.now();
      const TIMEOUT_MS = 5000;
      const POLL_MS = 50;
      while (!useSyncStatusStore.getState().isGameStateLoaded) {
        if (Date.now() - startedAt > TIMEOUT_MS) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      navigate('/main');
    } catch (err) {
      setError(getErrorMessage(err));
      setJoining(false);
    }
  };

  /**
   * 裏管理として入室（dev モード限定）
   *
   * - joinSession を呼ばない → participants / registeredPlayers /
   *   gameState.players のいずれにも名前が追加されない。
   * - currentUser を null のままにする → usePresence が no-op、
   *   updateInformation 等の updatedBy も付かない。
   * - 既存の isAdmin()/isCreator() は dev モード時に true を返すため、
   *   作成者と同等の権限で管理操作ができる。
   *
   * docs/plans/2026-05-19-hidden-admin-role.md
   */
  const handleEnterAsHiddenAdmin = async () => {
    if (!sessionId || !session) return;

    setJoining(true);
    setError('');

    // 別の共有セッションに居る場合は前セッションから離脱（handleJoin と同じ判定）
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
      // 別オンラインセッションへの切替時のみローカルストアをクリア（handleJoin と同じ理由）
      if (!isSameOnlineSession) {
        usePlayerStore.getState().clearPlayers();
        useGameStore.getState().clearHistory();
        useReservationStore.getState().clearReservations();
        usePairPreferenceStore.getState().clearPairPreferences();
        useAccountingStore.getState().clearRecords();
        useUndoStore.getState().clearAll();
      }

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
      // initialize は currentUser を session.createdBy で上書きするため null に戻す
      setCurrentUser(null);

      useSyncStatusStore.getState().setGameStateLoaded(false);
      const startedAt = Date.now();
      const TIMEOUT_MS = 5000;
      const POLL_MS = 50;
      while (!useSyncStatusStore.getState().isGameStateLoaded) {
        if (Date.now() - startedAt > TIMEOUT_MS) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      navigate('/main');
    } catch (err) {
      setError(getErrorMessage(err));
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">セッション読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
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
  // 全員入室済み、または選択中の名前が入室済みリストにある場合はアコーディオンを自動展開
  const allJoined = joinedPlayers.length > 0 && notJoinedPlayers.length === 0;
  const isJoinedExpanded =
    showJoinedOverride ?? (allJoined || (!!selectedName && joinedNames.has(selectedName)));

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* ヘッダー */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">参加者入室</h1>
        </div>

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
                onClick={() => setShowJoinedOverride(!isJoinedExpanded)}
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

          {/* dev モード限定: 観覧専用入室（裏管理）
              docs/plans/2026-05-19-hidden-admin-role.md */}
          {devMode && (
            <button
              onClick={() => void handleEnterAsHiddenAdmin()}
              disabled={joining}
              className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 disabled:opacity-50"
            >
              <EyeOff size={14} />
              裏管理として入室（観覧専用）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
