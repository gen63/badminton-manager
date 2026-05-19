import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useReservationStore } from '../stores/reservationStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useUndoStore } from '../stores/undoStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { EMPTY_COURT_STATE } from '../types/court';
import { parsePlayerInput } from '../lib/utils';
import { clearPresence, createSession, leaveSession } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { requestNotificationPermission } from '../lib/notifications';
import { clearAppBadge } from '../lib/badge';
import { PlayerAddInput } from '../components/PlayerAddInput';
import { Sparkles, Loader2, Play } from 'lucide-react';

// 現在日時を取得（曜日に応じて時刻を設定）
const getInitialDateTime = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0:日曜, 1:月曜, ..., 6:土曜
  
  // 曜日に応じて時刻を設定
  let hour: number;
  if (dayOfWeek === 0) {
    // 日曜: 17:00
    hour = 17;
  } else if (dayOfWeek === 6) {
    // 土曜: 12:00
    hour = 12;
  } else {
    // 平日（月〜金）: 19:00
    hour = 19;
  }
  
  now.setHours(hour, 0, 0, 0);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  return `${year}-${month}-${day}T${hourStr}:00`;
};

// 曜日に応じて体育館の初期値を設定
const getInitialGym = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0:日曜, 1:月曜, ..., 6:土曜
  
  if (dayOfWeek === 0) {
    // 日曜: 高松
    return '高松';
  } else if (dayOfWeek === 6) {
    // 土曜: 目白
    return '目白';
  } else {
    // 平日（月〜金）: ぴいす
    return 'ぴいす';
  }
};

export function SessionCreate() {
  const navigate = useNavigate();
  const initializeSession = useSessionStore((state) => state.initialize);

  // Phase 4 で常に Firebase 共有セッションを作成する（ローカルモード廃止）
  const [showCreatorSelect, setShowCreatorSelect] = useState(false);
  const [selectedCreatorName, setSelectedCreatorName] = useState('');
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);

  const { useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores, prioritizeDiversity, setPrioritizeDiversity, practiceType, setPracticeType } = useSettingsStore();

  const [targetScore] = useState(15);
  const [selectedGym] = useState(getInitialGym);
  const [practiceDateTime] = useState(getInitialDateTime);
  const [playerNames, setPlayerNames] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState('');

  // PWAバッジをクリア（セッションがない状態）
  useEffect(() => {
    clearAppBadge();
  }, []);

  const handleCreate = async () => {
    // プレイヤー名をパース（ローカルストアに触らずに直接パース）
    const playerInputs = playerNames.trim()
      ? playerNames
          .split('\n')
          .map((line) => parsePlayerInput(line))
          .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null)
      : [];

    const adjustedCourtCount = 1;
    const now = Date.now();
    const practiceTime = new Date(practiceDateTime).getTime();
    const sessionConfig = {
      courtCount: adjustedCourtCount,
      targetScore,
      practiceStartTime: practiceTime,
      gym: selectedGym || undefined,
    };

    // 作成者名が未選択の場合は選択画面へ（ここまで sideeffect なし）
    if (!selectedCreatorName) {
      setShowCreatorSelect(true);
      return;
    }

    setIsCreating(true);
    setLoadError('');

    // 旧オンラインセッションに居れば離脱処理（fire-and-forget）
    const previousSession = useSessionStore.getState().session;
    const previousUser = useSessionStore.getState().currentUser;
    if (previousSession?.id && previousSession.createdBy && previousUser) {
      void Promise.allSettled([
        leaveSession(previousSession.id, previousUser),
        clearPresence(previousSession.id, previousUser),
      ]);
    }

    // Firebase にセッション作成（CON3: gameState と同時に setDoc）
    try {
      const creatorName = selectedCreatorName;
      const registeredPlayers = playerInputs.map((p) => p.name);

      // 初期 gameState を構築
      const initialPlayers = playerInputs.map((input) => ({
        id: crypto.randomUUID(),
        name: input.name,
        rating: input.rating,
        gender: input.gender,
        isResting: true,
        gamesPlayed: 0,
        lastPlayedAt: 0,
        activatedAt: 0,
      }));
      const initialCourts = Array.from({ length: adjustedCourtCount }, (_, i) => ({
        id: i + 1,
        ...EMPTY_COURT_STATE,
      }));
      const { recordScores, continuousMatchMode, practiceType } = useSettingsStore.getState();
      const initialGameState = {
        players: initialPlayers,
        courts: initialCourts,
        matchHistory: [],
        reservations: [],
        settings: { recordScores, continuousMatchMode, practiceType },
      };

      // session + gameState を 1 回の setDoc で書き込む（孤立 doc を防ぐ）
      const sessionId = await createSession(
        {
          config: sessionConfig,
          createdBy: creatorName,
          participants: [creatorName],
          status: 'active',
          registeredPlayers,
        },
        initialGameState,
      );

      // 成功した時点で初めてローカル状態をリセット（前セッションは Firestore に残る）
      usePlayerStore.getState().clearPlayers();
      useGameStore.getState().clearHistory();
      useReservationStore.getState().clearReservations();
      useAccountingStore.getState().clearRecords();
      useUndoStore.getState().clearAll();

      // session を local sessionStore にセット（onSnapshot 購読のトリガー）
      initializeSession({
        id: sessionId,
        config: sessionConfig,
        createdAt: now,
        updatedAt: now,
        createdBy: creatorName,
        participants: [creatorName],
        status: 'active',
        registeredPlayers,
      });
      setCurrentUser(creatorName);

      requestNotificationPermission();

      // 作成直後の race 対策: useFirebaseSync の初回 onSnapshot で
      // isGameStateLoaded=true になるまで待ってから /main へ遷移する。
      // 旧フロー（URL 表示画面で一旦止まる）では自然な待ち時間で吸収されて
      // いた race を、直行に切り替えたため明示 polling で塞ぐ。
      // SessionJoinPage の handleJoin 末尾と同じパターン。
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
      setLoadError(getErrorMessage(err));
      setIsCreating(false);
    }
  };

  // オンラインモード: 作成者名選択画面（セッション作成前）
  if (showCreatorSelect) {
    const playerInputs = playerNames
      .split('\n')
      .map((line) => parsePlayerInput(line))
      .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);

    const handleCreatorNameSelect = () => {
      if (!selectedCreatorName) return;
      setShowCreatorSelect(false);
      // handleCreate()を再実行（今度はselectedCreatorNameがセットされているのでセッション作成へ）
      handleCreate();
    };

    const handleAddCreatorName = (name: string, gender: 'M' | 'F') => {
      // 重複チェック
      if (playerInputs.some((p) => p.name === name)) {
        setSelectedCreatorName(name);
        return;
      }
      const genderText = gender === 'M' ? '男' : '女';
      const newLine = `${name} ${genderText}`;
      setPlayerNames((prev) => prev ? `${prev}\n${newLine}` : newLine);
      setSelectedCreatorName(name);
    };

    return (
      <div className="overflow-x-hidden min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4">
          <div className="card p-6">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-foreground mb-1">あなたの名前を選択</h2>
              <p className="text-sm text-muted-foreground">セッション管理者として登録されます</p>
            </div>

            {playerInputs.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {playerInputs.map((input) => (
                  <button
                    key={input.name}
                    onClick={() => setSelectedCreatorName(input.name)}
                    className={`select-button text-sm px-2 py-2 ${
                      selectedCreatorName === input.name
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {selectedCreatorName === input.name && <span className="mr-1">✓</span>}
                    {input.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                下の入力欄から名前を追加してください
              </p>
            )}

            {/* 名前入力 */}
            <div className="border-t border-border pt-3 mb-4">
              <p className="text-xs text-muted-foreground mb-2">名前を入力して追加</p>
              <PlayerAddInput onAdd={handleAddCreatorName} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreatorSelect(false);
                  setSelectedCreatorName('');
                }}
                className="btn-secondary flex-1"
              >
                戻る
              </button>
              <button
                onClick={handleCreatorNameSelect}
                disabled={!selectedCreatorName}
                className="btn-primary flex-1"
              >
                セッション作成
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-hidden">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Play size={20} />
            <h1 className="text-lg font-bold">セッション開始</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full p-3">
        <div className="card p-6 space-y-6 overflow-hidden">

          {/* 当日参加者 */}
          <div>
            <label className="label">
              練習参加メンバー
            </label>
            <div className="max-w-[240px]">
              <textarea
                value={playerNames}
                onChange={(e) => setPlayerNames(e.target.value)}
                placeholder="星野真吾 男&#10;山口裕史 男&#10;佐野朋美 女"
                rows={3}
                className="textarea-field w-full"
                style={{ WebkitAppearance: 'none' }}
              />
              {loadError && (
                <p className="text-xs text-red-500 mt-2">{loadError}</p>
              )}
            </div>
          </div>

          {/* 練習種別 */}
          <div>
            <label className="label">練習種別</label>
            <div className="flex gap-2">
              {(['単', '複', '楽'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setPracticeType(type)}
                  className={`flex-1 select-button text-xs px-2 ${
                    practiceType === type ? 'select-button-active' : 'select-button-inactive'
                  }`}
                >
                  {practiceType === type && <span className="mr-1">✓</span>}
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* 配置モード */}
          <div>
            <label className="label">配置モード</label>
            <div className="flex gap-2">
              <button
                onClick={() => setUseStayDurationPriority(true)}
                className={`flex-1 select-button text-xs px-2 ${
                  useStayDurationPriority ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {useStayDurationPriority && <span className="mr-1">✓</span>}
                待機時間
              </button>
              <button
                onClick={() => setUseStayDurationPriority(false)}
                className={`flex-1 select-button text-xs px-2 ${
                  !useStayDurationPriority ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {!useStayDurationPriority && <span className="mr-1">✓</span>}
                試合回数
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {useStayDurationPriority ? '滞在時間が長い人を優先' : '試合回数が少ない人を優先'}
            </p>
          </div>

          {/* 勝敗記録 */}
          <div>
            <label className="label">勝敗記録</label>
            <div className="flex gap-2">
              <button
                onClick={() => setRecordScores(true)}
                className={`flex-1 select-button text-xs px-2 ${
                  recordScores ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {recordScores && <span className="mr-1">✓</span>}
                ON
              </button>
              <button
                onClick={() => setRecordScores(false)}
                className={`flex-1 select-button text-xs px-2 ${
                  !recordScores ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {!recordScores && <span className="mr-1">✓</span>}
                OFF
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {recordScores ? '終了時に勝敗を記録' : '終了時に勝敗を記録しない'}
            </p>
          </div>

          {/* 配置タイミング */}
          {(() => {
            const isSinglesMode = practiceType === '単';
            const isRelaxedMode = practiceType === '楽';
            const isLocked = isSinglesMode || isRelaxedMode;
            const diversityActive = isRelaxedMode || (!isSinglesMode && prioritizeDiversity);
            const countActive = isSinglesMode || (!isRelaxedMode && !prioritizeDiversity);
            return (
              <div>
                <label className="label">配置タイミング</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => !isLocked && setPrioritizeDiversity(true)}
                    disabled={isLocked}
                    className={`flex-1 select-button text-xs px-2 ${
                      diversityActive ? 'select-button-active' : 'select-button-inactive'
                    } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {diversityActive && <span className="mr-1">✓</span>}
                    多様性優先
                  </button>
                  <button
                    onClick={() => !isLocked && setPrioritizeDiversity(false)}
                    disabled={isLocked}
                    className={`flex-1 select-button text-xs px-2 ${
                      countActive ? 'select-button-active' : 'select-button-inactive'
                    } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {countActive && <span className="mr-1">✓</span>}
                    回数優先
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {isSinglesMode
                    ? 'シングルスでは回数優先が適用されます'
                    : isRelaxedMode
                    ? '楽では多様性優先が適用されます'
                    : prioritizeDiversity
                    ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
                    : '空きが出たら即座に配置'}
                </p>
              </div>
            );
          })()}

          {/* 作成ボタン */}
          <div className="flex justify-center">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="btn-primary text-base flex items-center justify-center gap-2"
            >
              {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              {isCreating ? '作成中...' : '開始'}
            </button>
          </div>
        </div>

        {/* バージョン表示 */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
