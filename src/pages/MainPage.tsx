import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts, sortWaitingPlayers } from '../lib/algorithm';
import { parsePlayerInput, getRecommendedCourtCount, shouldBlockForRotation } from '../lib/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { Coffee, Users, ArrowUp, Plus, X, Repeat, Undo2, Redo2, Play, StopCircle, Trash2, ChevronDown, Minus, Settings } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { useUndoStore } from '../stores/undoStore';
import { useReservationStore } from '../stores/reservationStore';

import { BottomNav } from '../components/BottomNav';

export function MainPage() {
  const navigate = useNavigate();
  const { session, updateConfig } = useSessionStore();
  const { players, toggleRest, updatePlayer, addPlayers } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame, resizeCourts, removeCourtById } =
    useGameStore();
  const { useStayDurationPriority, continuousMatchMode, setContinuousMatchMode, prioritizeRotation } = useSettingsStore();

  // total active players cache used by flow-priority checks
  const totalActiveCount = players.filter(p => !p.isResting).length;
  const { undoStack, redoStack, pushUndo, undo, redo } = useUndoStore();
  const { reservations, fulfillReservation } = useReservationStore();
  const toast = useToast();
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    courtId?: number;
    position?: number;
  } | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [recentlyRestoredIds, setRecentlyRestoredIds] = useState<Set<string>>(new Set());
  const [showAddPlayer, setShowAddPlayer] = useState(false);

  const playerCardRef = useRef<HTMLDivElement>(null);
  const heightLockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    return () => {
      if (heightLockTimer.current) clearTimeout(heightLockTimer.current);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ブロック条件成立時に連続モードを強制OFF
  // 「配置済み（準備中）」もプレイ中と同様に扱う
  useEffect(() => {
    if (!prioritizeRotation || !continuousMatchMode) return;
    const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
    const active = players.filter(p => !p.isResting);
    const actualWaiting = active.length - occupied.length * 4;
    if (occupied.length > 0 && actualWaiting < 7) {
      setContinuousMatchMode(false);
    }
  }, [prioritizeRotation, continuousMatchMode, courts, players, setContinuousMatchMode]);


  if (!session) {
    navigate('/');
    return null;
  }

  const handleClearCourt = (courtId: number) => {
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

  const handleAddCourt = () => {
    if (courts.length < 3) {
      const newCount = courts.length + 1;
      resizeCourts(newCount);
      updateConfig({ courtCount: newCount });

      // コート増加後に待機人数が不足する場合、連続モードをOFF
      if (continuousMatchMode) {
        const activeCount = players.filter(p => !p.isResting).length;
        const waitingAfter = activeCount - newCount * 4;
        const threshold = prioritizeRotation ? 7 : 3;
        if (waitingAfter < threshold) {
          setContinuousMatchMode(false);
        }
      }
    }
  };

  const handleRemoveCourt = (courtId: number) => {
    if (courts.length <= 1) return;
    const court = courts.find(c => c.id === courtId);
    if (!court) return;
    const hasPlayers = court.teamA[0] && court.teamA[0] !== '';
    if (hasPlayers || court.isPlaying) return;
    removeCourtById(courtId);
    updateConfig({ courtCount: courts.length - 1 });
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
        }
      );

      // 配置されたプレイヤーIDを集める
      const assignedPlayerIds = new Set(
        assignments.flatMap(a => [...a.teamA, ...a.teamB])
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

  const handleContinuousNext = (courtId: number) => {
    const { courts, matchHistory, updateCourt, startGame } = useGameStore.getState();
    const { players } = usePlayerStore.getState();
    const { useStayDurationPriority, prioritizeRotation } = useSettingsStore.getState();

    // 最新の待機プレイヤーを計算
    const playersInCourts = new Set(
      courts.flatMap(c => [...c.teamA, ...c.teamB]).filter(id => id?.trim())
    );
    const waitingPlayers = players.filter(
      p => !p.isResting && !playersInCourts.has(p.id)
    );

    // ブロックチェック（prioritizeRotation ON時）
    if (prioritizeRotation) {
      const occupied = courts.filter(c => c.isPlaying || (c.teamA[0] && c.teamA[0] !== ''));
      const active = players.filter(p => !p.isResting);
      const actualWaiting = active.length - occupied.length * 4;
      if (occupied.length > 0 && actualWaiting < 7) {
        setContinuousMatchMode(false);
        return;
      }
    }

    if (waitingPlayers.length < 7) {
      toast.error('待機中のプレイヤーが足りません');
      return;
    }

    // 配置アルゴリズム実行
    const assignments = assignCourts(waitingPlayers, 1, matchHistory, {
      targetCourtIds: [courtId],
      totalCourtCount: courts.length,
      useStayDurationPriority,
      reservations: reservations,
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
  const shouldBlockAssignment = shouldBlockForRotation(
    prioritizeRotation,
    occupiedCourts.length,
    emptyCourts.length,
    waitingCount,
    totalActiveCount,
    3
  );
  const shouldBlockContinuous = shouldBlockForRotation(
    prioritizeRotation,
    occupiedCourts.length,
    emptyCourts.length,
    waitingCount,
    totalActiveCount,
    7
  );
  const canAutoAssign = emptyCourts.length > 0 && sortedWaitingPlayers.length >= 4 && !shouldBlockAssignment;
  const canAddCourt = courts.length < 3 && totalActiveCount >= (courts.length + 1) * 4;

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
      const recommended = getRecommendedCourtCount(activeCount, courts.length);
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

  const formatElapsedTime = (startedAt: number) => {
    const elapsed = Math.floor((currentTime - startedAt) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
            {shouldBlockAssignment && emptyCourts.length > 0 && (
              <span className="text-[10px] text-muted-foreground leading-tight min-w-0">全コート終了を待って一括配置を推奨</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Undo2 size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Redo2 size={18} />
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted text-muted-foreground transition-colors"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-[60px]">
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
                        <span>{formatElapsedTime(court.startedAt)}</span>
                      </div>
                    ) : !hasPlayers && courts.length > 1 && (
                      <button
                        onClick={() => handleRemoveCourt(court.id)}
                        className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-destructive/20 hover:text-destructive transition-colors"
                        aria-label="コート削除"
                      >
                        <Minus size={12} />
                      </button>
                    )}
                  </div>
                  
                  {hasPlayers ? (
                    <div className="p-2 flex flex-col gap-2 min-h-[220px]">
                      <div className="flex flex-col gap-1">
                        {court.teamA.map((playerId, idx) => {
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
                        {court.teamB.map((playerId, idx) => {
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
                            pushUndo({
                              courts: structuredClone(useGameStore.getState().courts),
                              players: structuredClone(usePlayerStore.getState().players),
                              matchHistory: structuredClone(useGameStore.getState().matchHistory),
                              reservations: structuredClone(useReservationStore.getState().reservations),
                            });
                            finishGame(court.id, 0, 0);
                            [...court.teamA, ...court.teamB].forEach((playerId) => {
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
                          className="w-full py-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <StopCircle size={14} />
                          終了
                        </button>
                      ) : (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleStartGame(court.id)}
                            className="flex-1 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Play size={14} />
                            開始
                          </button>
                          <button
                            onClick={() => handleClearCourt(court.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
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
                      {shouldBlockAssignment ? (
                        <p className="text-[10px] text-muted-foreground">他コート終了後に一括配置してください</p>
                      ) : (
                        <button
                          onClick={() => handleAutoAssign(court.id)}
                          disabled={!canAutoAssign}
                          className="px-3 py-1.5 bg-white border border-border shadow-sm rounded-lg text-xs font-medium text-primary flex items-center gap-1.5 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={12} />
                          配置
                        </button>
                      )}
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
                className="w-8 h-8 rounded-full bg-background/20 hover:bg-background/30 flex items-center justify-center text-background"
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
              <div className="bg-card p-3 rounded-2xl border border-border flex gap-2 shadow-sm">
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
                    className="w-full h-10 pl-3 pr-3 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                  className="h-10 w-10 bg-secondary text-secondary-foreground rounded-xl font-semibold text-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80 transition-colors"
                >
                  <Plus size={18} />
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
                      <div className="absolute top-0.5 right-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleRestWithLock(player.id);
                          }}
                          className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors"
                          aria-label="休憩"
                        >
                          <Coffee className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPlayer(null);
                          }}
                          className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center border border-white"
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
          <div className="flex flex-col gap-3">
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
                      <div className="absolute top-0.5 right-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleRestWithLock(player.id);
                          }}
                          className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                      </div>
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

      <BottomNav activeTab="court" />
    </div>
  );
}
