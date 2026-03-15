import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useReservationStore } from '../stores/reservationStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useUndoStore } from '../stores/undoStore';
import { generateSessionId, parsePlayerInput } from '../lib/utils';
import { fetchMembersFromSheets, membersToText } from '../lib/sheetsMembers';
import { createSession, syncGameStateWithTransaction } from '../services/sessionService';
import { getErrorMessage } from '../lib/errorHandler';
import { isFirebaseConfigured } from '../lib/firebase';
import { requestNotificationPermission } from '../lib/notifications';
import { clearAppBadge } from '../lib/badge';
import { SessionURLDisplay } from '../components/SessionURLDisplay';
import { Sparkles, Download, Loader2, Play, LogIn } from 'lucide-react';

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
  const location = useLocation();
  const setSession = useSessionStore((state) => state.setSession);
  const initializeSession = useSessionStore((state) => state.initialize);

  // オンラインモード判定
  const isPhase1Mode = location.pathname === '/session/create';
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [showCreatorSelect, setShowCreatorSelect] = useState(false);
  const [selectedCreatorName, setSelectedCreatorName] = useState('');
  const setCurrentUser = useSessionStore((state) => state.setCurrentUser);
  const { addPlayers } = usePlayerStore();
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const gasWebAppUrl = useSettingsStore((state) => state.gasWebAppUrl);
  const { useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores, prioritizeDiversity, setPrioritizeDiversity } = useSettingsStore();

  const [targetScore] = useState(15);
  const [selectedGym] = useState(getInitialGym);
  const [practiceDateTime] = useState(getInitialDateTime);
  const [playerNames, setPlayerNames] = useState('');
  const [practiceType, setPracticeType] = useState<'単' | '複' | '楽'>('複');
  
  // Phase 1: セッションID参加機能
  const [showJoinMode, setShowJoinMode] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState('');
  const [clipboardDetected, setClipboardDetected] = useState<string | null>(null);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [allRated, setAllRated] = useState(false);

  // PWAバッジをクリア（セッションがない状態）
  useEffect(() => {
    clearAppBadge();
  }, []);

  // クリップボード自動検出（Phase 1）
  useEffect(() => {
    const detectClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && /^[A-Z0-9]{6}$/.test(text.trim())) {
          setClipboardDetected(text.trim());
        }
      } catch {
        // クリップボード読み取り権限がない場合は無視
      }
    };
    
    if (showJoinMode) {
      detectClipboard();
    }
  }, [showJoinMode]);

  const handleJoinSession = () => {
    const id = joinSessionId.trim().toUpperCase();
    if (id.length === 6) {
      navigate(`/session/${id}`);
    }
  };

  const handleLoadFromSheets = async () => {
    if (!gasWebAppUrl) {
      setLoadError('設定画面でGAS Web App URLを設定してください');
      return;
    }
    setIsLoadingMembers(true);
    setLoadError('');
    const result = await fetchMembersFromSheets(gasWebAppUrl);
    
    if (result.success) {
      // 入力欄に名前があるかチェック
      const hasInputNames = playerNames.trim().length > 0;
      
      let inputs: { name: string; rating?: number; gender?: 'M' | 'F' }[];
      let hasAllRatings = false;
      
      if (!hasInputNames) {
        // パターン1: 入力欄が空 → 今まで通り全データ取得
        setPlayerNames(membersToText(result.members));
        hasAllRatings = result.members.length > 0 &&
          result.members.every(m => m.rating != null && m.rating >= 1);
        
        inputs = result.members.map((member) => ({
          name: member.name,
          rating: member.rating,
          gender: member.gender,
        }));
      } else {
        // パターン2: 入力欄に名前あり → 性別だけを補完
        const inputLines = playerNames
          .split('\n')
          .map(line => parsePlayerInput(line))
          .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);
        
        // Sheetsから取得した性別情報でマッチング
        const sheetsMembersMap = new Map(
          result.members.map(m => [m.name, m.gender])
        );
        
        inputs = inputLines.map((input) => {
          const genderFromSheets = sheetsMembersMap.get(input.name);
          return {
            name: input.name,
            rating: input.rating, // 入力済みのレーティングがあればそれを使う（なければundefined）
            gender: input.gender || genderFromSheets, // 入力済みの性別優先、なければSheetsから補完
          };
        });
        
        // 入力欄を更新（性別が補完された状態）
        const updatedText = inputs.map((input) => {
          const parts = [input.name];
          if (input.gender) {
            parts.push(input.gender === 'M' ? '男' : '女');
          }
          if (input.rating) {
            parts.push(String(input.rating));
          }
          return parts.join('  ');
        }).join('\n');
        setPlayerNames(updatedText);
        
        hasAllRatings = false; // 名前入力モードではレーティングは不要
      }
      
      setAllRated(hasAllRatings);
      
      // パターン1のみ自動開始（入力欄が空だった場合）
      if (!hasInputNames && inputs.length > 0) {
        addPlayers(inputs);

        const adjustedCourtCount = 1;
        const sessionId = generateSessionId();
        const now = Date.now();
        const practiceTime = new Date(practiceDateTime).getTime();
        const session = {
          id: sessionId,
          config: {
            courtCount: adjustedCourtCount,
            targetScore,
            practiceDate: practiceDateTime.split('T')[0],
            practiceStartTime: practiceTime,
            gym: selectedGym || undefined,
          },
          createdAt: now,
          updatedAt: now,
        };

        setSession(session);
        initializeCourts(adjustedCourtCount);

        // ローディング状態を解除してから遷移
        setIsLoadingMembers(false);
        
        // 少し待ってから遷移（状態更新の完了を待つ）
        setTimeout(() => {
          navigate('/main');
        }, 100);
        return;
      }
      
      // パターン2（名前入力済み）の場合は、性別補完後に留まる
      setIsLoadingMembers(false);
    } else {
      setLoadError(result.message);
    }
    setIsLoadingMembers(false);
  };

  const handleCreate = async () => {
    // 重要: 新規セッション作成前に古いデータを完全クリア
    // （前のセッションのデータが残らないように）
    usePlayerStore.getState().clearPlayers();
    useGameStore.getState().clearHistory();
    useReservationStore.getState().clearReservations();
    useAccountingStore.getState().clearRecords();
    useUndoStore.getState().clearAll();

    // プレイヤー名をパース
    const playerInputs = playerNames.trim()
      ? playerNames
          .split('\n')
          .map((line) => parsePlayerInput(line))
          .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null)
      : [];

    if (playerInputs.length > 0) {
      addPlayers(playerInputs);
    }

    const adjustedCourtCount = 1;
    const now = Date.now();
    const practiceTime = new Date(practiceDateTime).getTime();
    const sessionConfig = {
      courtCount: adjustedCourtCount,
      targetScore,
      practiceDate: practiceDateTime.split('T')[0],
      practiceStartTime: practiceTime,
      gym: selectedGym || undefined,
    };

    // オンラインモード: 作成者名が未選択の場合は選択画面へ
    if (isPhase1Mode && !selectedCreatorName) {
      setShowCreatorSelect(true);
      return;
    }

    // オンラインモード: Firebaseにセッション作成
    if (isPhase1Mode) {
      try {
        const creatorName = selectedCreatorName;
        const registeredPlayers = playerInputs.map((p) => p.name);
        const sessionId = await createSession({
          config: sessionConfig,
          createdBy: creatorName,
          participants: [creatorName],
          status: 'active',
          registeredPlayers,
        });

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
        setCurrentUser(creatorName); // 自動入室
        initializeCourts(adjustedCourtCount);

        // 初期ゲーム状態をFirestoreにpush（参加者がすぐ取得できるように）
        const { players } = usePlayerStore.getState();
        const { courts, matchHistory } = useGameStore.getState();
        await syncGameStateWithTransaction(sessionId, { players, courts, matchHistory, reservations: [] });

        setCreatedSessionId(sessionId);
        requestNotificationPermission();
      } catch (err) {
        setLoadError(getErrorMessage(err));
      }
      return;
    }

    // ローカルモード: LocalStorageのみ
    const sessionId = generateSessionId();
    const session = {
      id: sessionId,
      config: sessionConfig,
      createdAt: now,
      updatedAt: now,
    };

    setSession(session);
    initializeCourts(adjustedCourtCount);
    navigate('/main');
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

    return (
      <div className="bg-app overflow-x-hidden min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4">
          <div className="card p-6">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-foreground mb-1">あなたの名前を選択</h2>
              <p className="text-sm text-muted-foreground">セッション管理者として登録されます</p>
            </div>

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

  // Phase 1: セッションID参加画面
  if (showJoinMode) {
    return (
      <div className="bg-app overflow-x-hidden min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="card p-6">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
                <LogIn size={24} className="text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">セッションに参加</h2>
              <p className="text-sm text-muted-foreground">6文字のセッションIDを入力してください</p>
            </div>

            {/* クリップボード検出 */}
            {clipboardDetected && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 mb-2">
                  クリップボードにセッションIDがあります
                </p>
                <button
                  onClick={() => navigate(`/session/${clipboardDetected}`)}
                  className="text-sm text-blue-600 font-medium underline"
                >
                  {clipboardDetected} を使用
                </button>
              </div>
            )}

            {/* セッションID入力 */}
            <div className="mb-4">
              <label className="label">セッションID</label>
              <input
                type="text"
                value={joinSessionId}
                onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="input-field text-center text-2xl font-bold tracking-wider"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoinSession();
                }}
              />
            </div>

            {/* ボタン */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowJoinMode(false);
                  setJoinSessionId('');
                  setClipboardDetected(null);
                }}
                className="btn-secondary flex-1"
              >
                キャンセル
              </button>
              <button
                onClick={handleJoinSession}
                disabled={joinSessionId.length !== 6}
                className="btn-primary flex-1"
              >
                参加する
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // オンラインモード: URL表示画面
  if (createdSessionId) {
    return (
      <div className="bg-app overflow-x-hidden min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <SessionURLDisplay
            sessionId={createdSessionId}
            onClose={() => navigate('/main')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-app overflow-x-hidden">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
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
              <div className="relative">
                <textarea
                  value={playerNames}
                  onChange={(e) => setPlayerNames(e.target.value)}
                  placeholder="星野真吾 男&#10;山口裕史 男&#10;佐野朋美 女"
                  rows={3}
                  className="textarea-field w-full pr-12"
                  style={{ WebkitAppearance: 'none' }}
                />
                
                {/* 小さいアイコンボタン */}
                <button
                  onClick={handleLoadFromSheets}
                  disabled={isLoadingMembers}
                  className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-muted hover:bg-secondary disabled:bg-muted disabled:opacity-50 flex items-center justify-center transition-colors"
                  title="Sheetsから読み込み"
                >
                  {isLoadingMembers ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : (
                    <Download size={14} className="text-muted-foreground" />
                  )}
                </button>
              </div>
              
              {/* Rバッジとエラー表示 */}
              <div className="flex items-center gap-2 mt-2">
                {allRated && (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">
                    R
                  </span>
                )}
                {loadError && (
                  <p className="text-xs text-red-500">{loadError}</p>
                )}
              </div>
            </div>
          </div>

          {/* 練習種別 */}
          <div>
            <label className="label">練習種別</label>
            <div className="flex gap-2">
              {(['単', '複', '楽'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setPracticeType(type);
                    if (type === '単') setPrioritizeDiversity(false);
                  }}
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
              {recordScores ? '終了時に勝敗を記録' : '勝敗記録なし'}
            </p>
          </div>

          {/* 配置タイミング */}
          {(() => {
            const isSinglesMode = practiceType === '単';
            return (
              <div>
                <label className="label">配置タイミング</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => !isSinglesMode && setPrioritizeDiversity(true)}
                    disabled={isSinglesMode}
                    className={`flex-1 select-button text-xs px-2 ${
                      !isSinglesMode && prioritizeDiversity ? 'select-button-active' : 'select-button-inactive'
                    } ${isSinglesMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {!isSinglesMode && prioritizeDiversity && <span className="mr-1">✓</span>}
                    多様性優先
                  </button>
                  <button
                    onClick={() => !isSinglesMode && setPrioritizeDiversity(false)}
                    disabled={isSinglesMode}
                    className={`flex-1 select-button text-xs px-2 ${
                      isSinglesMode || !prioritizeDiversity ? 'select-button-active' : 'select-button-inactive'
                    } ${isSinglesMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {(isSinglesMode || !prioritizeDiversity) && <span className="mr-1">✓</span>}
                    回数優先
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {isSinglesMode
                    ? ''
                    : prioritizeDiversity
                    ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
                    : '空きが出たら即座に配置'}
                </p>
              </div>
            );
          })()}

          {/* 作成ボタン */}
          <div className="flex justify-center gap-3">
            <button
              onClick={handleCreate}
              className="btn-primary text-base flex items-center justify-center gap-2"
            >
              <Sparkles size={18} />
              開始
            </button>

            {/* セッションIDで参加（Firebase設定時のみ表示） */}
            {isFirebaseConfigured() && (
              <button
                onClick={() => setShowJoinMode(true)}
                className="btn-secondary text-sm flex items-center justify-center gap-2"
              >
                <LogIn size={16} />
                セッションIDで参加
              </button>
            )}
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
