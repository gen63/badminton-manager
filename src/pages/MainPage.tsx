import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts, sortWaitingPlayers } from '../lib/algorithm';
import { parsePlayerInput, getRecommendedCourtCount, shouldBlockForDiversity } from '../lib/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { Coffee, Users, Plus, X, Repeat, Undo2, Redo2, StopCircle, Trash2, ChevronDown, Minus, Settings, Info } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { useUndoStore } from '../stores/undoStore';
import { useReservationStore } from '../stores/reservationStore';
import { useRealtimeSession } from '../hooks/useRealtimeSession';
import { useFirebaseSync } from '../hooks/useFirebaseSync';
import { useAccountingStore } from '../stores/accountingStore';
import { PaymentModal } from '../components/PaymentModal';
import { CourtTimer } from '../components/CourtTimer';
import { updatePaymentBadge } from '../lib/badge';

import { BottomNav } from '../components/BottomNav';

export function MainPage() {
  const navigate = useNavigate();
  const { session, updateConfig, currentUser, isAdmin, updateInformation, markInformationAsRead } = useSessionStore();

  // オンラインモード時のリアルタイム同期
  const isSharedSession = !!session?.createdBy;
  useRealtimeSession(isSharedSession ? session?.id ?? null : null);
  useFirebaseSync();
  const { players, toggleRest, updatePlayer, addPlayers, toggleOperationStatus, setPaymentAmount } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame, resizeCourts, removeCourtById } =
    useGameStore();
  const { useStayDurationPriority, continuousMatchMode, setContinuousMatchMode, prioritizeDiversity } = useSettingsStore();

  // ゲームモード判定
  const isSingles = session?.config.gameMode === 'singles';
  const playersPerCourt = isSingles ? 2 : 4;

  // total active players cache used by flow-priority checks
  const totalActiveCount = players.filter(p => !p.isResting).length;
  const { undoStack, redoStack, pushUndo, undo, redo } = useUndoStore();
  const { reservations, fulfillReservation } = useReservationStore();
  const accountingStore = useAccountingStore();
  const maleFee = accountingStore.lastInput?.maleFee || 800;
  const femaleFee = accountingStore.lastInput?.femaleFee || 600;
  const toast = useToast();
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    courtId?: number;
    position?: number;
  } | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [recentlyRestoredIds, setRecentlyRestoredIds] = useState<Set<string>>(new Set());
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [paymentModalPlayer, setPaymentModalPlayer] = useState<{ id: string; name: string; defaultAmount: number } | null>(null);
  const [showInformationModal, setShowInformationModal] = useState(false);
  const [informationText, setInformationText] = useState('');

  const playerCardRef = useRef<HTMLDivElement>(null);
  const heightLockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (heightLockTimer.current) clearTimeout(heightLockTimer.current);
    };
  }, []);

  // ブロック条件成立時に連続モードを強制OFF
  // 「配置済み（準備中）」もプレイ中と同様に扱う
  useEffect(() => {
    if (!prioritizeDiversity || !continuousMatchMode) return;
    const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
    const active = players.filter(p => !p.isResting);
    const ppc = isSingles ? 2 : 4;
    const actualWaiting = active.length - occupied.length * ppc;
    const threshold = isSingles ? 3 : 7;
    if (occupied.length > 0 && actualWaiting < threshold) {
      setContinuousMatchMode(false);
    }
  }, [prioritizeDiversity, continuousMatchMode, courts, players, setContinuousMatchMode, isSingles]);

  // Ctrl+Z / Ctrl+Y キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // config.courtCount と courts.length を同期（オンラインモード時）
  useEffect(() => {
    if (!session?.createdBy) return; // ローカルモードでは不要
    const configCourtCount = session.config.courtCount || 1;
    if (courts.length !== configCourtCount) {
      console.log('[MainPage] Auto-resizing courts:', { from: courts.length, to: configCourtCount });
      resizeCourts(configCourtCount);
    }
  }, [session?.config.courtCount, courts.length, session?.createdBy, resizeCourts]);

  // PWAバッジ更新：支払い予定額を表示
  useEffect(() => {
    if (!session || !currentUser) {
      // セッションがない、またはログインしていない場合はバッジをクリア
      updatePaymentBadge(true);
      return;
    }

    const currentPlayer = players.find(p => p.name === currentUser);
    if (!currentPlayer) {
      // プレイヤー情報がない場合はバッジをクリア
      updatePaymentBadge(true);
      return;
    }

    const isPaid = currentPlayer.operationStatus?.payment ?? false;
    const amount = currentPlayer.paymentAmount;

    updatePaymentBadge(isPaid, amount);
  }, [session, currentUser, players]);

  if (!session) {
    navigate('/');
    return null;
  }

  const handleClearCourt = (courtId: number) => {
    pushUndo();
    updateCourt(courtId, {
      teamA: ['', ''],
      teamB: ['', ''],
      scoreA: 0,
      scoreB: 0,
      isPlaying: false,
      startedAt: null,
      finishedAt: null,
    });
  };

  const handleAddCourt = async () => {
    if (courts.length < 3) {
      const newCount = courts.length + 1;
      resizeCourts(newCount);
      updateConfig({ courtCount: newCount });

      // コート増加後に待機人数が不足する場合、連続モードをOFF
      if (continuousMatchMode) {
        const activeCount = players.filter(p => !p.isResting).length;
        const waitingAfter = activeCount - newCount * playersPerCourt;
        const threshold = prioritizeDiversity ? (isSingles ? 3 : 7) : 2;
        if (waitingAfter < threshold) {
          setContinuousMatchMode(false);
        }
      }

      // コート数変更は重要な操作なので、即座にFirestoreにpush（デバウンスをスキップ）
      if (session?.id && session?.createdBy) {
        const { syncGameStateWithTransaction } = await import('../services/sessionService');
        const { players: currentPlayers } = usePlayerStore.getState();
        const { courts: currentCourts, matchHistory: currentHistory } = useGameStore.getState();
        const { reservations: currentReservations } = useReservationStore.getState();
        
        syncGameStateWithTransaction(session.id, {
          players: currentPlayers,
          courts: currentCourts,
          matchHistory: currentHistory,
          reservations: currentReservations,
        }).catch((err) => {
          console.error('[handleAddCourt] Failed to sync:', err);
        });
      }
    }
  };

  const handleRemoveCourt = async (courtId: number) => {
    if (courts.length <= 1) return;
    const court = courts.find(c => c.id === courtId);
    if (!court) return;
    const hasPlayers = court.teamA[0] && court.teamA[0] !== '';
    if (hasPlayers || court.isPlaying) return;
    removeCourtById(courtId);
    updateConfig({ courtCount: courts.length - 1 });

    // コート数変更は重要な操作なので、即座にFirestoreにpush（デバウンスをスキップ）
    if (session?.id && session?.createdBy) {
      const { syncGameStateWithTransaction } = await import('../services/sessionService');
      const { players: currentPlayers } = usePlayerStore.getState();
      const { courts: currentCourts, matchHistory: currentHistory } = useGameStore.getState();
      const { reservations: currentReservations } = useReservationStore.getState();
      
      syncGameStateWithTransaction(session.id, {
        players: currentPlayers,
        courts: currentCourts,
        matchHistory: currentHistory,
        reservations: currentReservations,
      }).catch((err) => {
        console.error('[handleRemoveCourt] Failed to sync:', err);
      });
    }
  };

  const pendingReservations = reservations.filter(r => r.status === 'pending');

  const handleAutoAssign = (courtId?: number) => {
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
          gameMode: session?.config.gameMode,
        }
      );

      // 配置されたプレイヤーIDを集める（空文字を除外）
      const assignedPlayerIds = new Set(
        assignments.flatMap(a => [...a.teamA, ...a.teamB]).filter(id => id && id.trim())
      );

      // 予約消化判定: 予約メンバー全員が配置されたら fulfilled
      for (const reservation of pendingReservations) {
        if (reservation.playerIds.every(id => assignedPlayerIds.has(id))) {
          fulfillReservation(reservation.id);
        }
      }

      const isBulk = !courtId;
      assignments.forEach((assignment) => {
        updateCourt(assignment.courtId, {
          teamA: assignment.teamA,
          teamB: assignment.teamB,
          scoreA: 0,
          scoreB: 0,
          isPlaying: isBulk,
          startedAt: isBulk ? Date.now() : null,
          finishedAt: null,
        });
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'プレイヤーの配置に失敗しました'
      );
    }
  };

  const handleStartGame = (courtId: number) => {
    startGame(courtId);
  };

  const handlePaymentClick = (playerId: string) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    // デフォルト金額（会計設定から）
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

  const handlePaymentConfirm = (amount: number) => {
    if (!paymentModalPlayer) return;
    
    // 金額を保存
    setPaymentAmount(paymentModalPlayer.id, amount);
    
    // 支払い完了フラグをON
    toggleOperationStatus(paymentModalPlayer.id, 'payment');
    
    setPaymentModalPlayer(null);
  };

  const handleContinuousNext = (courtId: number) => {
    const { courts, matchHistory, updateCourt, startGame } = useGameStore.getState();
    const { players } = usePlayerStore.getState();
    const { useStayDurationPriority, prioritizeDiversity } = useSettingsStore.getState();
    const currentGameMode = useSessionStore.getState().session?.config.gameMode;
    const ppc = currentGameMode === 'singles' ? 2 : 4;

    // 最新の待機プレイヤーを計算
    const playersInCourts = new Set(
      courts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id?.trim())
    );
    const waitingPlayers = players.filter(
      p => !p.isResting && !playersInCourts.has(p.id)
    );

    // ブロックチェック（prioritizeDiversity ON時）
    if (prioritizeDiversity) {
      const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
      const active = players.filter(p => !p.isResting);
      const actualWaiting = active.length - occupied.length * ppc;
      const threshold = currentGameMode === 'singles' ? 3 : 7;
      if (occupied.length > 0 && actualWaiting < threshold) {
        setContinuousMatchMode(false);
        return;
      }
    }

    const minWaiting = currentGameMode === 'singles' ? 3 : 7;
    if (waitingPlayers.length < minWaiting) {
      toast.error('待機中のプレイヤーが足りません');
      return;
    }

    // 配置アルゴリズム実行
    const assignments = assignCourts(waitingPlayers, 1, matchHistory, {
      targetCourtIds: [courtId],
      totalCourtCount: courts.length,
      useStayDurationPriority,
      reservations: reservations,
      gameMode: currentGameMode,
    });

    if (assignments[0]) {
      const assignment = assignments[0];
      updateCourt(courtId, {
        teamA: assignment.teamA,
        teamB: assignment.teamB,
        scoreA: 0,
        scoreB: 0,
        isPlaying: false,
        startedAt: null,
        finishedAt: null,
      });
      startGame(courtId);
    } else {
      toast.error('配置アルゴリズムでエラーが発生しました');
    }
  };



  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  const getPlayerGender = (playerId: string): 'M' | 'F' | undefined => {
    return players.find((p) => p.id === playerId)?.gender;
  };

  const getPlayerGamesPlayed = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.gamesPlayed || 0;
  };

  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  );

  const waitingPlayersUnsorted = players
    .filter((p) => !p.isResting && !playersInCourts.has(p.id));

  const sortedWaitingPlayers = sortWaitingPlayers(waitingPlayersUnsorted, {
    emptyCourtIds: courts
      .filter(c => !c.teamA[0] || c.teamA[0] === '')
      .map(c => c.id),
    totalCourtCount: courts.length,
    matchHistory,
    allActivePlayers: players.filter(p => !p.isResting),
    practiceStartTime: session?.config.practiceStartTime ?? 0,
    useStayDuration: useStayDurationPriority,
  });
  const restingPlayers = players.filter((p) => p.isResting);
  const restingAndPlaceholderPlayers = players.filter(
    p => p.isResting || recentlyRestoredIds.has(p.id)
  );

  const emptyCourts = courts.filter(c => !c.teamA[0] || c.teamA[0] === '');
  const occupiedCourts = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
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
    isSingles ? 3 : 7,
    playersPerCourt
  );
  const canAutoAssign = emptyCourts.length > 0 && sortedWaitingPlayers.length >= playersPerCourt;
  const canAddCourt = courts.length < 3 && totalActiveCount >= (courts.length + 1) * playersPerCourt;

  const handleSwapPlayer = (courtId: number, position: number, newPlayerId: string) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    const newTeamA = [...court.teamA];
    const newTeamB = [...court.teamB];

    if (position < 2) {
      newTeamA[position] = newPlayerId;
    } else {
      newTeamB[position - 2] = newPlayerId;
    }

    const newPlayer = players.find((p) => p.id === newPlayerId);
    const restingPlayerIds = [...(court.restingPlayerIds || [])];
    if (newPlayer?.isResting && !restingPlayerIds.includes(newPlayerId)) {
      restingPlayerIds.push(newPlayerId);
    }

    updateCourt(courtId, {
      teamA: [newTeamA[0], newTeamA[1]],
      teamB: [newTeamB[0], newTeamB[1]],
      restingPlayerIds,
    });

    if (newPlayer?.isResting) {
      updatePlayer(newPlayerId, { isResting: false });
    }
  };

  const handleToggleRestWithLock = (playerId: string) => {
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

    toggleRest(playerId);

    // 休憩に入る場合（toggleRest前のisResting=false）、コート数を自動縮小
    if (!player?.isResting) {
      const activeCount = players.filter(p => !p.isResting && p.id !== playerId).length;
      const recommended = getRecommendedCourtCount(activeCount, courts.length, playersPerCourt);
      if (recommended < courts.length) {
        resizeCourts(recommended);
        updateConfig({ courtCount: recommended });
      }

      const waitingAfterRest = players.filter(p => !p.isResting && p.id !== playerId && !playersInCourts.has(p.id)).length;
      if (waitingAfterRest <= 1 && continuousMatchMode) {
        setContinuousMatchMode(false);
      }
    }
  };

  const handlePlayerTap = (
    playerId: string,
    courtId?: number,
    position?: number
  ) => {
    const player = players.find(p => p.id === playerId);
    
    // 休憩中メンバーをタップした場合
    if (player?.isResting) {
      // コート上のメンバーが選択されている場合のみ交換
      if (selectedPlayer?.courtId !== undefined && selectedPlayer?.position !== undefined) {
        handleSwapPlayer(selectedPlayer.courtId, selectedPlayer.position, playerId);
        setSelectedPlayer(null);
      } else {
        // それ以外（選択なし or 待機中メンバー選択）は復帰のみ
        toggleRest(playerId);
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

            updateCourt(courtId, {
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

            updateCourt(selectedPlayer.courtId!, {
              teamA: [allPlayers1[0], allPlayers1[1]],
              teamB: [allPlayers1[2], allPlayers1[3]],
            });
            updateCourt(courtId, {
              teamA: [allPlayers2[0], allPlayers2[1]],
              teamB: [allPlayers2[2], allPlayers2[3]],
            });
          }
        }
      } else if (
        selectedPlayer.courtId !== undefined &&
        selectedPlayer.position !== undefined
      ) {
        handleSwapPlayer(
          selectedPlayer.courtId,
          selectedPlayer.position,
          playerId
        );
      } else if (courtId !== undefined && position !== undefined) {
        handleSwapPlayer(courtId, position, selectedPlayer.id);
      }
      setSelectedPlayer(null);
    }
  };

  const handleUndo = () => {
    undo();
  };

  const handleRedo = () => {
    redo();
  };

  return (
    <div className="flex flex-col h-full bg-muted/30 font-sans relative overflow-y-auto scrollbar-hide text-foreground">
      <header className="sticky top-0 flex-none bg-background border-b border-border px-4 py-2.5 shadow-sm z-20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setContinuousMatchMode(!continuousMatchMode)}
              disabled={shouldBlockContinuous}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 ${
                continuousMatchMode
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              <Repeat size={16} />
              <span>連続</span>
              {continuousMatchMode && <span className="text-[10px] bg-green-200 px-1.5 py-0.5 rounded-full font-bold">ON</span>}
            </button>
            <button
              onClick={() => handleAutoAssign()}
              disabled={!canAutoAssign}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
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
                className={`relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-colors ${
                  session?.information?.text || isAdmin()
                    ? 'hover:bg-muted text-blue-600'
                    : 'text-muted-foreground/30 cursor-not-allowed'
                }`}
                aria-label="お知らせ"
              >
                <Info size={20} />
                {session?.information?.text && currentUser && !session.information.readBy.includes(currentUser) && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white" />
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="元に戻す"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="やり直し"
            >
              <Redo2 size={18} />
            </button>
            {isAdmin() && (
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-muted text-muted-foreground transition-colors"
              >
                <Settings size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

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
                  onClick={() => toggleOperationStatus(currentPlayer.id, 'roster')}
                  className="text-xs py-1 px-3 rounded-lg font-medium transition-colors"
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
                      <span className={`text-xs font-semibold ${!court.isPlaying && !hasPlayers ? 'text-muted-foreground' : ''}`}>
                        {court.isPlaying && matchNumber ? `#${matchNumber}` : hasPlayers ? '準備中' : '空き'}
                      </span>
                    </div>
                    {court.isPlaying && court.startedAt ? (
                      <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2"/>
                        </svg>
                        <CourtTimer startedAt={court.startedAt} />
                      </div>
                    ) : !hasPlayers && courts.length > 1 && (
                      <button
                        onClick={() => handleRemoveCourt(court.id)}
                        className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-destructive/20 hover:text-destructive transition-colors"
                        aria-label="コート削除"
                      >
                        <Minus size={12} />
                      </button>
                    )}
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
                          onClick={() => {
                            const currentCourt = courts.find((c) => c.id === court.id);
                            if (!currentCourt) return;
                            pushUndo();
                            finishGame(court.id, 0, 0);
                            [...court.teamA, ...court.teamB].filter(id => id).forEach((playerId) => {
                              const player = players.find((p) => p.id === playerId);
                              if (player) {
                                updatePlayer(playerId, {
                                  gamesPlayed: player.gamesPlayed + 1,
                                  lastPlayedAt: Date.now(),
                                });
                              }
                            });
                            if (court.restingPlayerIds && court.restingPlayerIds.length > 0) {
                              court.restingPlayerIds.forEach((playerId: string) => {
                                updatePlayer(playerId, { isResting: true });
                              });
                            }
                            updateCourt(court.id, {
                              teamA: ['', ''],
                              teamB: ['', ''],
                              scoreA: 0,
                              scoreB: 0,
                              isPlaying: false,
                              startedAt: null,
                              finishedAt: null,
                              restingPlayerIds: [],
                            });
                            if (continuousMatchMode) {
                              handleContinuousNext(court.id);
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
            {courts.length < 3 && (
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">待機中 ({sortedWaitingPlayers.length})</h3>
              <button
                onClick={() => setShowAddPlayer(!showAddPlayer)}
                className="text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} />
                <span>{showAddPlayer ? '閉じる' : 'メンバー追加'}</span>
                <ChevronDown size={14} className={`transition-transform ${showAddPlayer ? 'rotate-180' : ''}`} />
              </button>
            </div>
            
            {/* Add Member - Collapsible */}
            {showAddPlayer && (
              <div className="bg-card p-6 rounded-2xl border border-border flex gap-2 shadow-sm">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPlayerName.trim()) {
                        const parsed = parsePlayerInput(newPlayerName.trim(), /\s+/);
                        if (parsed) {
                          const result = addPlayers([parsed]);
                          if (result.skipped.length > 0) {
                            toast.warning(`「${result.skipped[0]}」は既に登録済みです`);
                          } else {
                            setNewPlayerName('');
                          }
                        }
                      }
                    }}
                    className="w-full h-10 pl-3 pr-3 bg-input border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="こば 男"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => {
                    if (newPlayerName.trim()) {
                      const parsed = parsePlayerInput(newPlayerName.trim(), /\s+/);
                      if (parsed) {
                        const result = addPlayers([parsed]);
                        if (result.skipped.length > 0) {
                          toast.warning(`「${result.skipped[0]}」は既に登録済みです`);
                        } else {
                          setNewPlayerName('');
                        }
                      }
                    }
                  }}
                  disabled={!newPlayerName.trim()}
                  className="h-10 px-4 bg-secondary text-secondary-foreground rounded-xl font-semibold text-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80 transition-colors whitespace-nowrap"
                >
                  追加
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {sortedWaitingPlayers.map((player) => {
                const isSelected = selectedPlayer?.id === player.id;
                const isReserved = pendingReservations.some(r => r.playerIds.includes(player.id));

                return (
                  <button
                    key={player.id}
                    onClick={() => handlePlayerTap(player.id)}
                    className={`relative group bg-card border hover:border-primary/50 active:bg-accent/10 rounded-xl px-2 py-[3px] flex flex-col items-center justify-center gap-0 shadow-sm transition-all text-left h-[58px] ${
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
                      <div className="absolute top-0.5 left-0.5">
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
                onClick={() => setShowInformationModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {isAdmin() ? (
              /* 管理者: 編集モード */
              <>
                <textarea
                  value={informationText}
                  onChange={(e) => setInformationText(e.target.value)}
                  className="flex-1 w-full p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 mb-4"
                  placeholder="メンバーへの周知事項を入力..."
                  rows={8}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowInformationModal(false);
                      setInformationText('');
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

      <BottomNav activeTab="court" />
    </div>
  );
}
