import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { assignCourts, sortWaitingPlayers } from '../lib/algorithm';
import { getRecommendedCourtCount, shouldBlockForDiversity } from '../lib/utils';
import { PlayerAddInput } from '../components/PlayerAddInput';
import { useSettingsStore } from '../stores/settingsStore';
import { Coffee, Users, Plus, X, Repeat, Undo2, Redo2, StopCircle, Trash2, ChevronDown, Minus, Settings, Info, MessageSquare } from 'lucide-react';
import { sendBugReportToDiscord } from '../lib/bugReport';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { useUndoStore } from '../stores/undoStore';
import { useReservationStore } from '../stores/reservationStore';
import { usePresence } from '../hooks/usePresence';
import { usePresenceStore } from '../stores/presenceStore';
import { PresenceIndicator } from '../components/PresenceIndicator';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { useGuardedAction } from '../hooks/useGuardedAction';
import * as sm from '../services/sessionMutations';
import { PaymentModal } from '../components/PaymentModal';
import { WinnerSelectModal } from '../components/WinnerSelectModal';
import { CourtTimer } from '../components/CourtTimer';
import { updatePaymentBadge } from '../lib/badge';
import { EMPTY_COURT_STATE } from '../types/court';
import { checkContinuousBlock, getPlayersPerCourt, getMinWaitingCount, gameModeFromPracticeType } from '../lib/gameOperations';
import { PRACTICE_TYPE_OPTIONS } from '../lib/accountingCalc';

import { BottomNav } from '../components/BottomNav';

const BUG_REPORT_TEMPLATE = '発生画面：\n期待値：\n実際：';

export function MainPage() {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.session);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const currentUser = useSessionStore((s) => s.currentUser);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const updateInformation = useSessionStore((s) => s.updateInformation);
  const markInformationAsRead = useSessionStore((s) => s.markInformationAsRead);

  // useFirebaseSync (App level) が session/gameState/presence の onSnapshot を統合管理。
  // ここではプレゼンスの送出だけ行う。
  usePresence(session?.id ?? null, currentUser);
  const remotePresence = usePresenceStore((s) => s.remotePresence);
  const toast = useToast();
  // 書き込みは sessionMutations.X 経由のトランザクション。エラーは toast に通知。
  const writer = useSessionWriterWithToast(toast);
  const isGameStateLoaded = useSyncStatusStore((s) => s.isGameStateLoaded);

  // 連続クリックでトグルが打ち消し合うのを防ぐガード（CON1）。
  const continuousModeToggle = useGuardedAction(async (next: boolean) => {
    await writer.setContinuousMatchMode(next);
  });
  const rosterToggle = useGuardedAction(async (playerId: string) => {
    await writer.toggleOperationStatus(playerId, 'roster');
  });
  const paymentToggle = useGuardedAction(async (playerId: string, amount: number) => {
    await writer.applyPayment(playerId, amount);
  });
  const players = usePlayerStore((s) => s.players);
  const courts = useGameStore((s) => s.courts);
  const matchHistory = useGameStore((s) => s.matchHistory);
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const continuousMatchMode = useSettingsStore((s) => s.continuousMatchMode);
  const prioritizeDiversity = useSettingsStore((s) => s.prioritizeDiversity);
  const recordScores = useSettingsStore((s) => s.recordScores);
  const practiceType = useSettingsStore((s) => s.practiceType);

  // gameMode はユーザーが設定で切り替える practiceType を単一の真実として扱う。
  // session.config.gameMode は auto-create-session などで 'doubles' に固定されるため参照しない。
  const gameMode = gameModeFromPracticeType(practiceType);
  const playersPerCourt = getPlayersPerCourt(gameMode);

  // total active players cache used by flow-priority checks
  const totalActiveCount = players.filter(p => !p.isResting).length;
  const undoStack = useUndoStore((s) => s.undoStack);
  const redoStack = useUndoStore((s) => s.redoStack);
  const pushUndo = useUndoStore((s) => s.pushUndo);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const reservations = useReservationStore((s) => s.reservations);
  const practiceDefaults =
    PRACTICE_TYPE_OPTIONS.find((t) => t.value === practiceType) ?? PRACTICE_TYPE_OPTIONS[0];
  const maleFee = session?.accounting?.maleFee ?? practiceDefaults.maleFee;
  const femaleFee = session?.accounting?.femaleFee ?? practiceDefaults.femaleFee;
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    courtId?: number;
    position?: number;
  } | null>(null);

  const [recentlyRestoredIds, setRecentlyRestoredIds] = useState<Set<string>>(new Set());
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [paymentModalPlayer, setPaymentModalPlayer] = useState<{ id: string; name: string; defaultAmount: number } | null>(null);
  const [showInformationModal, setShowInformationModal] = useState(false);
  const [informationText, setInformationText] = useState('');
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [bugReportText, setBugReportText] = useState(BUG_REPORT_TEMPLATE);
  const [isSendingBugReport, setIsSendingBugReport] = useState(false);
  const [pendingScoreMatch, setPendingScoreMatch] = useState<{
    matchId: string;
    courtId: number;
    teamA: [string, string];
    teamB: [string, string];
  } | null>(null);

  const playerCardRef = useRef<HTMLDivElement>(null);

  // モーダル表示中にsession.informationが更新されたら、メンバー閲覧時のみ同期
  // 管理者の編集中テキストは上書きしない
  useEffect(() => {
    if (showInformationModal && session?.information?.text && !isAdmin()) {
      setInformationText(session.information.text);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isAdmin is a stable Zustand selector
  }, [session?.information?.text, showInformationModal]);

  const heightLockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (heightLockTimer.current) clearTimeout(heightLockTimer.current);
    };
  }, []);

  // ブロック条件成立時に連続モードを強制OFF
  useEffect(() => {
    if (!prioritizeDiversity || !continuousMatchMode) return;
    // 初回 onSnapshot 前は players/courts が空のため誤判定を避ける
    if (session?.createdBy && !isGameStateLoaded) return;
    if (checkContinuousBlock(players, courts, prioritizeDiversity, gameMode).blocked) {
      void writer.setContinuousMatchMode(false);
    }
  }, [prioritizeDiversity, continuousMatchMode, courts, players, writer, gameMode, session?.createdBy, isGameStateLoaded]);

  // Ctrl+Z / Ctrl+Y キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // config.courtCount と courts.length を同期（オンラインモード時）
  // 初回 onSnapshot 受信前に走ると空配列を「正規」と誤認して Firestore を上書きするので
  // isGameStateLoaded をガードに使う。
  useEffect(() => {
    if (!session?.createdBy) return; // ローカルモードでは不要
    if (!isGameStateLoaded) return;
    const configCourtCount = session.config.courtCount || 1;
    if (courts.length !== configCourtCount) {
      void writer.resizeCourts(configCourtCount);
    }
  }, [session?.config.courtCount, courts.length, session?.createdBy, writer, isGameStateLoaded]);

  // PWAバッジ更新：支払い予定額を表示
  useEffect(() => {
    if (!session || !currentUser) {
      updatePaymentBadge(true);
      return;
    }

    const currentPlayer = players.find(p => p.name === currentUser);
    if (!currentPlayer) {
      updatePaymentBadge(true);
      return;
    }

    const isPaid = currentPlayer.operationStatus?.payment ?? false;
    const amount = currentPlayer.paymentAmount;

    updatePaymentBadge(isPaid, amount);
  }, [session, currentUser, players]);

  const playersInCourts = useMemo(() => new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  ), [courts]);

  const { sortedWaitingPlayers, restingPlayers, emptyCourts, occupiedCourts } = useMemo(() => {
    const waitingPlayersUnsorted = players.filter((p) => !p.isResting && !playersInCourts.has(p.id));
    const sorted = sortWaitingPlayers(waitingPlayersUnsorted, {
      emptyCourtIds: courts.filter(c => !c.teamA[0] || c.teamA[0] === '').map(c => c.id),
      totalCourtCount: courts.length,
      matchHistory,
      allActivePlayers: players.filter(p => !p.isResting),
      practiceStartTime: session?.config.practiceStartTime ?? 0,
      useStayDuration: useStayDurationPriority,
    });
    return {
      sortedWaitingPlayers: sorted,
      restingPlayers: players.filter((p) => p.isResting),
      emptyCourts: courts.filter(c => !c.teamA[0] || c.teamA[0] === ''),
      occupiedCourts: courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== '')),
    };
  }, [players, courts, matchHistory, playersInCourts, session?.config.practiceStartTime, useStayDurationPriority]);

  const restingAndPlaceholderPlayers = useMemo(() => players.filter(
    p => p.isResting || recentlyRestoredIds.has(p.id)
  ), [players, recentlyRestoredIds]);

  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const getPlayerName = useCallback((playerId: string) => {
    return playerMap.get(playerId)?.name || '未設定';
  }, [playerMap]);

  const getPlayerGender = useCallback((playerId: string): 'M' | 'F' | undefined => {
    return playerMap.get(playerId)?.gender;
  }, [playerMap]);

  const getPlayerGamesPlayed = useCallback((playerId: string) => {
    return playerMap.get(playerId)?.gamesPlayed || 0;
  }, [playerMap]);

  if (!session) {
    navigate('/');
    return null;
  }

  const handleClearCourt = async (courtId: number) => {
    pushUndo();
    await writer.updateCourt(courtId, EMPTY_COURT_STATE);
  };

  const handleAddCourt = async () => {
    if (courts.length >= 3) return;
    const newCount = courts.length + 1;

    // gameState.courts と session.config.courtCount を 1 transaction でアトミックに（H6）
    await writer.resizeCourtsWithConfig(newCount);

    // コート増加後に待機人数が不足する場合、連続モードをOFF
    if (continuousMatchMode) {
      const activeCount = players.filter(p => !p.isResting).length;
      const waitingAfter = activeCount - newCount * playersPerCourt;
      const threshold = prioritizeDiversity ? getMinWaitingCount(gameMode) : 2;
      if (waitingAfter < threshold) {
        await writer.setContinuousMatchMode(false);
      }
    }
  };

  const handleRemoveCourt = async (courtId: number) => {
    if (courts.length <= 1) return;
    const court = courts.find(c => c.id === courtId);
    if (!court) return;
    const hasPlayers = court.teamA[0] && court.teamA[0] !== '';
    if (hasPlayers || court.isPlaying) return;

    // 特定の court id を削除する必要があるので resize ではなく removeCourt を使う。
    // gameState.courts と session.config.courtCount の更新は 2 transaction だが、
    // 空コートのみ削除可能で実害は小さいので Phase 6 ではそのまま許容する。
    await writer.removeCourtById(courtId);
    updateConfig({ courtCount: courts.length - 1 });
  };

  const pendingReservations = reservations.filter(r => r.status === 'pending');

  const handleAutoAssign = async (courtId?: number) => {
    try {
      let courtsToAssign: number[];
      if (courtId) {
        courtsToAssign = [courtId];
      } else {
        courtsToAssign = courts
          .filter(c => !c.teamA[0] || c.teamA[0] === '')
          .map(c => c.id);
      }

      const waitingPlayers = players.filter(
        (p) => !p.isResting && !playersInCourts.has(p.id)
      );

      const allActivePlayers = players.filter(p => !p.isResting);

      const assignments = assignCourts(
        waitingPlayers,
        courtsToAssign.length,
        matchHistory,
        {
          totalCourtCount: courts.length,
          targetCourtIds: courtsToAssign,
          practiceStartTime: session?.config.practiceStartTime,
          allPlayers: allActivePlayers,
          useStayDurationPriority,
          reservations,
          gameMode,
        }
      );

      // 配置されたプレイヤーIDを集める（空文字を除外）
      const assignedPlayerIds = new Set(
        assignments.flatMap(a => [...a.teamA, ...a.teamB]).filter(id => id && id.trim())
      );

      // 予約消化判定: 予約メンバー全員が配置されたら fulfilled
      const fulfilledIds = pendingReservations
        .filter((r) => r.playerIds.every((id) => assignedPlayerIds.has(id)))
        .map((r) => r.id);

      // 1 transaction で予約消化 + 全コート割当（H4 修正）
      const isBulk = !courtId;
      const startedAt = isBulk ? Date.now() : 0;
      await writer.autoAssignAndFulfill(
        assignments.map((a) => ({
          courtId: a.courtId,
          teamA: a.teamA,
          teamB: a.teamB,
          isPlaying: isBulk,
          startedAt,
        })),
        fulfilledIds,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'プレイヤーの配置に失敗しました'
      );
    }
  };

  const handleStartGame = async (courtId: number) => {
    await writer.startGame(courtId);
  };

  const handlePaymentClick = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    const defaultAmount = player.gender === 'M'
      ? maleFee
      : player.gender === 'F'
      ? femaleFee
      : maleFee; // 性別不明の場合は男性料金

    setPaymentModalPlayer({
      id: player.id,
      name: player.name,
      defaultAmount,
    });
  };

  const handlePaymentConfirm = async (amount: number) => {
    if (!paymentModalPlayer) return;
    await paymentToggle.run(paymentModalPlayer.id, amount);
    setPaymentModalPlayer(null);
  };

  // Phase 4: 試合終了の連続モードは sm.finishMatchAndContinue が transaction 内で
  // computeFinishAndContinue を実行するため、ローカルでの handleContinuousNext は不要。

  const waitingCount = sortedWaitingPlayers.length;
  const shouldBlockAssignment = shouldBlockForDiversity(
    prioritizeDiversity,
    occupiedCourts.length,
    emptyCourts.length,
    waitingCount,
    totalActiveCount,
    2,
    playersPerCourt
  );
  const shouldBlockContinuous = shouldBlockForDiversity(
    prioritizeDiversity,
    occupiedCourts.length,
    emptyCourts.length,
    waitingCount,
    totalActiveCount,
    getMinWaitingCount(gameMode),
    playersPerCourt
  );
  const canAutoAssign = emptyCourts.length > 0 && sortedWaitingPlayers.length >= playersPerCourt;
  const canAddCourt = courts.length < 3 && totalActiveCount >= (courts.length + 1) * playersPerCourt;

  const handleSwapPlayer = async (courtId: number, position: number, newPlayerId: string) => {
    if (position < 0 || position > 3) return;
    // CON2: コート更新と isResting=false への遷移を 1 transaction でアトミックに
    await writer.swapPlayer(courtId, position as 0 | 1 | 2 | 3, newPlayerId);
  };

  const handleToggleRestWithLock = async (playerId: string) => {
    const player = players.find(p => p.id === playerId);

    if (player?.isResting) {
      setRecentlyRestoredIds(prev => new Set(prev).add(playerId));
      setTimeout(() => {
        setRecentlyRestoredIds(prev => {
          const next = new Set(prev);
          next.delete(playerId);
          return next;
        });
      }, 300);
    }

    if (playerCardRef.current) {
      playerCardRef.current.style.minHeight = `${playerCardRef.current.offsetHeight}px`;
      if (heightLockTimer.current) clearTimeout(heightLockTimer.current);
      heightLockTimer.current = setTimeout(() => {
        if (playerCardRef.current) {
          playerCardRef.current.style.minHeight = '';
        }
      }, 300);
    }

    await writer.toggleRest(playerId);

    // 休憩に入る場合（toggleRest前のisResting=false）、コート数を自動縮小
    // コート数変更・連続モード操作は管理者のみに限定（一般ユーザの休憩切替が間接的に
    // session.config.courtCount や continuousMatchMode を変更しないようガード）
    if (!player?.isResting && isAdmin()) {
      const activeCount = players.filter(p => !p.isResting && p.id !== playerId).length;
      const recommended = getRecommendedCourtCount(activeCount, courts.length, playersPerCourt);
      if (recommended < courts.length) {
        await writer.resizeCourts(recommended);
        updateConfig({ courtCount: recommended });
      }

      const waitingAfterRest = players.filter(p => !p.isResting && p.id !== playerId && !playersInCourts.has(p.id)).length;
      if (waitingAfterRest <= 1 && continuousMatchMode) {
        await writer.setContinuousMatchMode(false);
      }
    }
  };

  const handlePlayerTap = async (
    playerId: string,
    courtId?: number,
    position?: number
  ) => {
    const player = players.find(p => p.id === playerId);
    
    // 休憩中メンバーをタップした場合
    if (player?.isResting) {
      // コート上のメンバーが選択されている場合のみ交換
      if (selectedPlayer?.courtId !== undefined && selectedPlayer?.position !== undefined) {
        const swapPromise = handleSwapPlayer(selectedPlayer.courtId, selectedPlayer.position, playerId);
        setSelectedPlayer(null);
        await swapPromise;
      } else {
        // それ以外（選択なし or 待機中メンバー選択）は復帰のみ
        void writer.toggleRest(playerId);
        setSelectedPlayer(null);
      }
      return;
    }
    
    // 以下は待機中・コート上メンバーの処理（従来通り）
    if (!selectedPlayer) {
      setSelectedPlayer({ id: playerId, courtId, position });
    } else if (selectedPlayer.id === playerId) {
      setSelectedPlayer(null);
    } else {
      if (
        selectedPlayer.courtId !== undefined &&
        selectedPlayer.position !== undefined &&
        courtId !== undefined &&
        position !== undefined
      ) {
        if (selectedPlayer.courtId === courtId) {
          const court = courts.find((c) => c.id === courtId);
          if (court) {
            const allPlayers = [...court.teamA, ...court.teamB];
            const temp = allPlayers[selectedPlayer.position];
            allPlayers[selectedPlayer.position] = allPlayers[position];
            allPlayers[position] = temp;

            await writer.updateCourt(courtId, {
              teamA: [allPlayers[0], allPlayers[1]],
              teamB: [allPlayers[2], allPlayers[3]],
            });
          }
        } else {
          const court1 = courts.find((c) => c.id === selectedPlayer.courtId);
          const court2 = courts.find((c) => c.id === courtId);
          if (court1 && court2) {
            const allPlayers1 = [...court1.teamA, ...court1.teamB];
            const allPlayers2 = [...court2.teamA, ...court2.teamB];

            const temp = allPlayers1[selectedPlayer.position];
            allPlayers1[selectedPlayer.position] = allPlayers2[position];
            allPlayers2[position] = temp;

            await writer.updateCourt(selectedPlayer.courtId!, {
              teamA: [allPlayers1[0], allPlayers1[1]],
              teamB: [allPlayers1[2], allPlayers1[3]],
            });
            await writer.updateCourt(courtId, {
              teamA: [allPlayers2[0], allPlayers2[1]],
              teamB: [allPlayers2[2], allPlayers2[3]],
            });
          }
        }
      } else if (
        selectedPlayer.courtId !== undefined &&
        selectedPlayer.position !== undefined
      ) {
        await handleSwapPlayer(
          selectedPlayer.courtId,
          selectedPlayer.position,
          playerId
        );
      } else if (courtId !== undefined && position !== undefined) {
        await handleSwapPlayer(courtId, position, selectedPlayer.id);
      }
      setSelectedPlayer(null);
    }
  };

  const handleUndo = () => {
    void undo();
  };

  const handleRedo = () => {
    void redo();
  };

  const handleSendBugReport = async () => {
    if (bugReportText.trim() === '' || bugReportText === BUG_REPORT_TEMPLATE) {
      toast.error('内容を入力してください');
      return;
    }
    setIsSendingBugReport(true);
    const result = await sendBugReportToDiscord(
      import.meta.env.VITE_DISCORD_WEBHOOK_URL || '',
      bugReportText,
      {
        currentUser: currentUser ?? null,
        sessionId: session?.id ?? null,
        gym: session?.config.gym ?? null,
      }
    );
    setIsSendingBugReport(false);
    if (result.success) {
      toast.success(result.message);
      setBugReportText(BUG_REPORT_TEMPLATE);
      setShowBugReportModal(false);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/30 font-sans relative overflow-x-hidden overflow-y-auto scrollbar-hide text-foreground">
      <header className="sticky top-0 flex-none bg-background border-b border-border px-3 py-2.5 shadow-sm z-20">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            {isAdmin() && (
              <button
                onClick={() => void continuousModeToggle.run(!continuousMatchMode)}
                disabled={shouldBlockContinuous || continuousModeToggle.isPending}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 ${
                  continuousMatchMode
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-muted text-muted-foreground border border-border'
                }`}
              >
                <Repeat size={16} />
                <span>連続</span>
                <span className={`text-[10px] bg-green-200 py-0.5 rounded-full font-bold transition-all duration-150 ${
                  continuousMatchMode
                    ? 'opacity-100 max-w-[2rem] px-1.5'
                    : 'opacity-0 max-w-0 overflow-hidden px-0'
                }`}>ON</span>
              </button>
            )}
            <button
              onClick={() => handleAutoAssign()}
              disabled={!canAutoAssign}
              className="flex items-center gap-1 px-2 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              <Users size={16} />
              <span>一括</span>
            </button>
            {/* インフォメーションアイコン（オンラインモードのみ） */}
            {session?.createdBy && (
              <button
                onClick={() => {
                  // 管理者は周知事項がなくても編集モーダルを開ける
                  if (isAdmin()) {
                    setInformationText(session?.information?.text || '');
                    setShowInformationModal(true);
                  } else if (session?.information?.text) {
                    // メンバーは周知事項がある場合のみ閲覧＋既読化
                    setInformationText(session.information.text);
                    setShowInformationModal(true);
                    markInformationAsRead();
                  }
                }}
                disabled={!isAdmin() && !session?.information?.text}
                className={`relative flex items-center justify-center min-w-[36px] min-h-[36px] shrink-0 rounded-full transition-colors ${
                  session?.information?.text || isAdmin()
                    ? 'hover:bg-muted text-blue-600'
                    : 'text-muted-foreground/30 cursor-not-allowed'
                }`}
                aria-label="お知らせ"
              >
                <Info size={20} />
                {session?.information?.text && currentUser && !session.information.readBy?.includes(currentUser) && (
                  <span className="absolute top-1 right-0 h-[16px] flex items-center justify-center px-1.5 text-[10px] font-bold text-red-500 bg-white rounded-full border border-red-500 leading-none">
                    未読
                  </span>
                )}
              </button>
            )}
            {/* バグ報告アイコン（常時表示） */}
            <button
              onClick={() => {
                setBugReportText(BUG_REPORT_TEMPLATE);
                setShowBugReportModal(true);
              }}
              className="flex items-center justify-center min-w-[36px] min-h-[36px] shrink-0 rounded-full hover:bg-muted text-blue-600 transition-colors"
              aria-label="バグ報告"
            >
              <MessageSquare size={20} />
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="flex items-center justify-center min-w-[36px] min-h-[36px] shrink-0 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="元に戻す"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="flex items-center justify-center min-w-[36px] min-h-[36px] shrink-0 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="やり直し"
            >
              <Redo2 size={18} />
            </button>
            {isAdmin() && (
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center justify-center min-w-[36px] min-h-[36px] shrink-0 rounded-full hover:bg-muted text-muted-foreground transition-colors"
                aria-label="設定"
              >
                <Settings size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* プレゼンス表示（他ユーザーが画面を開いている/操作中のとき） */}
      {session?.id && (
        <div className="flex justify-center px-4 pt-2 pointer-events-none">
          <PresenceIndicator presence={remotePresence} currentUser={currentUser} />
        </div>
      )}

      {/* 運営タスク（自分の分だけ、全て完了で非表示） */}
      {currentUser && (() => {
        const currentPlayer = players.find(p => p.name === currentUser);
        if (!currentPlayer) return null;
        const status = currentPlayer.operationStatus || { payment: false, roster: false, checkin: false };
        const allCompleted = status.payment && status.roster;
        if (allCompleted) return null;

        return (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-blue-800">未完了タスク</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePaymentClick(currentPlayer.id)}
                  className="text-xs py-1 px-3 rounded-lg font-medium transition-colors"
                  style={{
                    backgroundColor: status.payment ? '#10b981' : '#e5e7eb',
                    color: status.payment ? '#ffffff' : '#6b7280',
                  }}
                >
                  {status.payment ? '✓' : ''}支払
                </button>
                <button
                  onClick={() => void rosterToggle.run(currentPlayer.id)}
                  disabled={rosterToggle.isPending}
                  className="text-xs py-1 px-3 rounded-lg font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: status.roster ? '#10b981' : '#e5e7eb',
                    color: status.roster ? '#ffffff' : '#6b7280',
                  }}
                >
                  {status.roster ? '✓' : ''}名簿
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {shouldBlockAssignment && courts.length > 1 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-center gap-2">
          <span className="text-xs text-amber-800 font-medium text-center">
            💡 組み合わせの多様性を確保するため、一括配置を推奨
          </span>
        </div>
      )}

      <main className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom)+1rem)]">
        {/* Courts Section */}
        <section className="pt-4 pb-2 px-4">
          <div className="grid grid-cols-3 gap-2">
            {courts.map((court) => {
              const hasPlayers = court.teamA[0] && court.teamA[0] !== '';
              const matchNumber = court.isPlaying && court.startedAt
                ? matchHistory.filter(m => m.finishedAt && m.finishedAt <= court.startedAt!).length + courts.filter(c => c.isPlaying && c.id < court.id).length + 1
                : null;

              return (
                <div key={court.id} className="w-full bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden min-w-0">
                  <div className="flex items-center justify-between px-2 py-2 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-1.5">
                      <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                        court.isPlaying ? 'bg-foreground text-background' : 'bg-muted-foreground text-white'
                      }`}>
                        {court.id}
                      </span>
                      <span className={`text-xs font-semibold whitespace-nowrap ${!court.isPlaying && !hasPlayers ? 'text-muted-foreground' : ''}`}>
                        {court.isPlaying && matchNumber ? `#${matchNumber}` : hasPlayers ? '準備中' : '空き'}
                      </span>
                    </div>
                    <div className="shrink-0 flex justify-end">
                      {court.isPlaying && court.startedAt ? (
                        <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tabular-nums whitespace-nowrap">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2"/>
                          </svg>
                          <CourtTimer startedAt={court.startedAt} />
                        </div>
                      ) : !hasPlayers && courts.length > 1 && isAdmin() && (
                        <button
                          onClick={() => handleRemoveCourt(court.id)}
                          className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-destructive/20 hover:text-destructive transition-colors"
                          aria-label="コート削除"
                        >
                          <Minus size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {hasPlayers ? (
                    <div className="p-2 flex flex-col gap-2 min-h-[220px]">
                      <div className="flex flex-col gap-1">
                        {court.teamA.filter((id) => id).map((playerId, idx) => {
                          const playerGender = getPlayerGender(playerId);
                          const textColor = playerGender === 'M' ? 'text-blue-600' : playerGender === 'F' ? 'text-pink-600' : 'text-muted-foreground';
                          return (
                            <button
                              key={idx}
                              onClick={() => handlePlayerTap(playerId, court.id, idx)}
                              className={`flex items-center justify-between bg-muted/30 p-1.5 rounded-lg border transition-colors ${
                                selectedPlayer?.id === playerId
                                  ? 'border-primary bg-accent'
                                  : 'border-transparent hover:border-border'
                              }`}
                            >
                              <span className={`font-medium truncate text-xs ${textColor}`}>
                                {getPlayerName(playerId)}
                              </span>
                              <span className="text-[9px] bg-background border px-1 rounded text-muted-foreground">
                                {getPlayerGamesPlayed(playerId)}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-center py-0.5">
                        <span className="text-[10px] font-black text-muted-foreground/50">VS</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        {court.teamB.filter((id) => id).map((playerId, idx) => {
                          const playerGender = getPlayerGender(playerId);
                          const textColor = playerGender === 'M' ? 'text-blue-600' : playerGender === 'F' ? 'text-pink-600' : 'text-muted-foreground';
                          return (
                            <button
                              key={idx}
                              onClick={() => handlePlayerTap(playerId, court.id, idx + 2)}
                              className={`flex items-center justify-between bg-muted/30 p-1.5 rounded-lg border transition-colors ${
                                selectedPlayer?.id === playerId
                                  ? 'border-primary bg-accent'
                                  : 'border-transparent hover:border-border'
                              }`}
                            >
                              <span className={`font-medium truncate text-xs ${textColor}`}>
                                {getPlayerName(playerId)}
                              </span>
                              <span className="text-[9px] bg-background border px-1 rounded text-muted-foreground">
                                {getPlayerGamesPlayed(playerId)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      
                      {court.isPlaying ? (
                        <button
                          onClick={async () => {
                            if (!session?.id) return;
                            const currentCourt = courts.find((c) => c.id === court.id);
                            if (!currentCourt) return;

                            const matchStartedAt = currentCourt.startedAt;
                            const matchId = crypto.randomUUID();

                            // Undo 用に試合終了前の状態を保存
                            pushUndo();

                            // スコア記録ONなら結果入力モーダルを表示（Firestore 書き込み前に
                            // capture しておく — 書き込み後は currentCourt.teamA/B が空になる）
                            const teamASnapshot = currentCourt.teamA;
                            const teamBSnapshot = currentCourt.teamB;

                            try {
                              const res = await sm.finishMatchAndContinue(
                                session.id,
                                court.id,
                                matchStartedAt,
                                {
                                  matchId,
                                  useStayDurationPriority,
                                  prioritizeDiversity,
                                },
                              );
                              if (res.result === 'already_finished') {
                                toast.info('他のユーザーが既に終了しました');
                                return;
                              }
                              // GAMEOPS4: 連続モードがブロックされた理由をユーザーに伝える
                              if (continuousMatchMode && !res.continuousNextApplied) {
                                if (res.continuousError === 'diversity_block') {
                                  toast.warning('待機人数が少ないため連続モードを停止しました');
                                } else if (res.continuousError === 'not_enough_players') {
                                  toast.info('待機中のプレイヤーが足りないため次の試合は配置されません');
                                } else if (res.continuousError === 'assignment_failed') {
                                  toast.error('連続配置に失敗しました');
                                }
                              }
                            } catch (err) {
                              console.error('[FinishGame] Transaction failed:', err);
                              toast.error('試合終了の同期に失敗しました');
                              return;
                            }

                            if (recordScores) {
                              setPendingScoreMatch({
                                matchId,
                                courtId: court.id,
                                teamA: teamASnapshot,
                                teamB: teamBSnapshot,
                              });
                            }
                          }}
                          className="w-full min-h-[44px] bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <StopCircle size={14} />
                          終了
                        </button>
                      ) : (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleStartGame(court.id)}
                            className="flex-1 min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                          >
                            開始
                          </button>
                          <button
                            onClick={() => handleClearCourt(court.id)}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4 gap-2 min-h-[220px]">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center text-muted-foreground">
                          <span className="font-bold text-xs">{court.id}</span>
                        </div>
                        <p className="text-xs text-muted-foreground font-medium">空き</p>
                      </div>
                      <div className="flex flex-col gap-1 items-center">
                        {shouldBlockAssignment && courts.length > 1 && (
                          <p className="text-[10px] text-amber-700">⚠️ 一括配置推奨</p>
                        )}
                        <button
                          onClick={() => handleAutoAssign(court.id)}
                          disabled={!canAutoAssign}
                          className="px-3 py-1.5 bg-card border border-border shadow-sm rounded-lg text-xs font-medium text-primary flex items-center gap-1.5 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={12} />
                          配置
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {courts.length < 3 && isAdmin() && (
              <button
                onClick={handleAddCourt}
                disabled={!canAddCourt}
                className={`w-full bg-card border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1 min-h-[80px] transition-colors ${
                  canAddCourt
                    ? 'border-border hover:border-primary/50 hover:bg-primary/5'
                    : 'border-border/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <Plus size={20} className="text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  {canAddCourt ? 'コート追加' : 'プレイヤー不足'}
                </span>
              </button>
            )}
          </div>
        </section>

        {/* Swap Player Modal */}
        {selectedPlayer && (
          <div className="px-4 mb-4">
            <div className="bg-foreground text-background p-3 rounded-xl shadow-xl flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-bold">{players.find(p => p.id === selectedPlayer.id)?.name} と交換</span>
                <span className="text-xs text-background/70">他のプレイヤーをタップ</span>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="min-w-[44px] min-h-[44px] rounded-full bg-background/20 hover:bg-background/30 flex items-center justify-center text-background"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Waiting Players */}
        <section className="px-4 flex flex-col gap-4 transition-all duration-300" ref={playerCardRef}>
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-foreground">待機中 ({sortedWaitingPlayers.length})</h3>

            <div className="grid grid-cols-3 gap-2">
              {sortedWaitingPlayers.map((player) => {
                const isSelected = selectedPlayer?.id === player.id;
                const isReserved = pendingReservations.some(r => r.playerIds.includes(player.id));

                return (
                  <button
                    key={player.id}
                    onClick={() => handlePlayerTap(player.id)}
                    className={`relative group bg-card border hover:border-primary/50 active:bg-accent/10 rounded-xl px-2 pt-[3px] pb-2 flex flex-col items-center justify-end gap-0 shadow-sm transition-all text-left h-[58px] ${
                      isSelected
                        ? 'ring-2 ring-primary ring-offset-1 border-primary'
                        : isReserved
                        ? 'border-orange-300 bg-orange-50/50'
                        : 'border-border'
                    }`}
                  >
                    {!isSelected && (
                      <div className="absolute top-1/2 -translate-y-1/2 right-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleRestWithLock(player.id);
                          }}
                          className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors"
                          aria-label="休憩"
                        >
                          <Coffee className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-1/2 -translate-y-1/2 right-1 z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPlayer(null);
                          }}
                          className="min-w-[44px] min-h-[44px] rounded-full bg-primary text-white flex items-center justify-center border border-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {isReserved && (
                      <div className="absolute -top-1 left-0.5">
                        <span className="px-1 py-0.5 bg-orange-500 text-white text-[8px] font-bold rounded">予約</span>
                      </div>
                    )}
                    <div className="w-full text-center">
                      <div className="text-sm font-semibold truncate text-foreground leading-tight">{player.name}</div>
                      <div className="text-xs flex items-center justify-center gap-1 leading-tight">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold leading-tight ${
                          player.gender === 'M'
                            ? 'bg-blue-100 text-blue-700'
                            : player.gender === 'F'
                            ? 'bg-pink-100 text-pink-700'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {player.gender === 'M' ? '男' : player.gender === 'F' ? '女' : player.gender}
                        </span>
                        <span className="text-muted-foreground leading-tight">{player.gamesPlayed}試合</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Member - between Waiting and On Break */}
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowAddPlayer(!showAddPlayer)}
              className="self-start text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1.5"
            >
              <Plus size={14} />
              <span>{showAddPlayer ? '閉じる' : 'メンバー追加'}</span>
              <ChevronDown size={14} className={`transition-transform ${showAddPlayer ? 'rotate-180' : ''}`} />
            </button>

            {showAddPlayer && (
              <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
                <PlayerAddInput
                  onAdd={async (name, gender) => {
                    const result = await writer.addPlayers([{ name, gender }]);
                    if (result.skipped.length > 0) {
                      toast.warning(`「${result.skipped[0]}」は既に登録済みです`);
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* On Break */}
          <div className="flex flex-col gap-3 mb-6">
            <h3 className="text-sm font-bold text-muted-foreground">休憩中 ({restingPlayers.length})</h3>
            {restingAndPlaceholderPlayers.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 opacity-75">
                {restingAndPlaceholderPlayers.map((player) => {
                  if (recentlyRestoredIds.has(player.id)) {
                    return <div key={player.id} className="relative bg-muted/50 border border-border rounded-xl px-2 py-[3px] flex flex-col items-center justify-center gap-0 shadow-sm h-[58px]" style={{ visibility: 'hidden' }} />;
                  }
                  return (
                    <button
                      key={player.id}
                      onClick={() => handlePlayerTap(player.id)}
                      className="relative bg-muted/50 border border-border rounded-xl px-2 py-[3px] flex flex-col items-center justify-center gap-0 shadow-sm hover:border-green-200 hover:bg-green-50/20 transition-colors h-[58px]"
                    >
                      <div className="w-full text-center">
                        <div className="text-sm font-semibold truncate text-muted-foreground leading-tight">{player.name}</div>
                        <div className="text-xs text-muted-foreground leading-tight">{player.gamesPlayed}試合</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60">休憩メンバー無し</p>
            )}
          </div>
        </section>
      </main>


      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}

      {/* 支払いモーダル */}
      {paymentModalPlayer && (
        <PaymentModal
          playerName={paymentModalPlayer.name}
          defaultAmount={paymentModalPlayer.defaultAmount}
          onConfirm={handlePaymentConfirm}
          onCancel={() => setPaymentModalPlayer(null)}
        />
      )}

      {/* インフォメーションモーダル */}
      {showInformationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Info size={20} className="text-blue-600" />
                お知らせ
              </h3>
              <button
                onClick={() => {
                  setShowInformationModal(false);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {isAdmin() ? (
              /* 管理者: 編集モード */
              <>
                <div className="flex-1 overflow-y-auto mb-4">
                  <textarea
                    value={informationText}
                    onChange={(e) => setInformationText(e.target.value)}
                    className="w-full min-h-[200px] p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="メンバーへの周知事項を入力..."
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowInformationModal(false);
                    }}
                    className="flex-1 btn-secondary"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => {
                      const trimmed = informationText.trim();
                      updateInformation(informationText);
                      setShowInformationModal(false);
                      toast.success(trimmed ? 'お知らせを更新しました' : 'お知らせを削除しました');
                    }}
                    className="flex-1 btn-primary"
                  >
                    保存
                  </button>
                </div>
              </>
            ) : (
              /* メンバー: 閲覧モード */
              <>
                <div className="flex-1 overflow-y-auto mb-4">
                  <div className="bg-muted/50 rounded-xl p-4">
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {informationText}
                    </p>
                  </div>
                  {session?.information?.updatedBy && (
                    <p className="text-xs text-muted-foreground mt-2 text-right">
                      更新: {session.information.updatedBy}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setShowInformationModal(false)}
                  className="w-full btn-primary"
                >
                  閉じる
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* バグ報告モーダル */}
      {showBugReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <MessageSquare size={20} className="text-blue-600" />
                バグ報告
              </h3>
              <button
                onClick={() => setShowBugReportModal(false)}
                disabled={isSendingBugReport}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto mb-4">
              <textarea
                value={bugReportText}
                onChange={(e) => setBugReportText(e.target.value)}
                disabled={isSendingBugReport}
                className="w-full min-h-[200px] p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                placeholder="発生画面、期待値、実際の挙動を入力..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBugReportModal(false)}
                disabled={isSendingBugReport}
                className="flex-1 btn-secondary disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSendBugReport}
                disabled={isSendingBugReport}
                className="flex-1 btn-primary disabled:opacity-50"
              >
                {isSendingBugReport ? '送信中...' : '送信'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 勝者選択モーダル */}
      {pendingScoreMatch && (
        <WinnerSelectModal
          courtId={pendingScoreMatch.courtId}
          teamA={pendingScoreMatch.teamA}
          teamB={pendingScoreMatch.teamB}
          getPlayerName={(id) => players.find((p) => p.id === id)?.name || '未設定'}
          getPlayerGender={(id) => players.find((p) => p.id === id)?.gender}
          onConfirm={async (winnerIds) => {
            if (winnerIds === 'unknown') {
              setPendingScoreMatch(null);
              return;
            }
            const teamASet = new Set(pendingScoreMatch.teamA.filter(Boolean));
            const teamBSet = new Set(pendingScoreMatch.teamB.filter(Boolean));
            const allInA = winnerIds.every((id) => teamASet.has(id));
            const allInB = winnerIds.every((id) => teamBSet.has(id));
            if (!allInA && !allInB) {
              // WINNER1 fix: WinnerSelectModal 側で異チーム選択は予防済みだが、
              // 万一呼ばれた場合は無言で閉じずトースト通知してスコア未保存を可視化する。
              toast.error('勝者が同じチームではありません。スコアは記録されませんでした');
              setPendingScoreMatch(null);
              return;
            }
            const winner: 'A' | 'B' = allInA ? 'A' : 'B';
            const scoreA = winner === 'A' ? 100 : 99;
            const scoreB = winner === 'B' ? 100 : 99;
            const matchId = pendingScoreMatch.matchId;
            // Phase 6: 共有ストアではなく Firestore transaction 経由で書き込む
            // （local setState だけだと次の onSnapshot で消える B4 修正）
            await writer.updateMatchScore(matchId, scoreA, scoreB, winner);
            setPendingScoreMatch(null);
          }}
          onCancel={() => setPendingScoreMatch(null)}
        />
      )}

      <BottomNav activeTab="court" />
    </div>
  );
}
