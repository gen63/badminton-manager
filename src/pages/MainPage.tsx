import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts, sortWaitingPlayers } from '../lib/algorithm';
import { parsePlayerInput } from '../lib/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { Settings, History, Coffee, Users, ArrowUp, Plus, X, Repeat, Undo2, Redo2, Play, StopCircle, Trash2, ChevronDown } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { useUndoStore } from '../stores/undoStore';

export function MainPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players, toggleRest, updatePlayer, addPlayers } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame } =
    useGameStore();
  const { useStayDurationPriority, continuousMatchMode, setContinuousMatchMode } = useSettingsStore();
  const { undoStack, redoStack, pushUndo, undo, redo } = useUndoStore();
  const toast = useToast();
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    courtId?: number;
    position?: number;
  } | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [showAllUnfinished, setShowAllUnfinished] = useState(false);
  const [recentlyRestoredIds, setRecentlyRestoredIds] = useState<Set<string>>(new Set());
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
        }
      );

      courtsToAssign.forEach((id, index) => {
        const assignment = assignments[index];
        if (assignment) {
          updateCourt(id, {
            teamA: assignment.teamA,
            teamB: assignment.teamB,
            scoreA: 0,
            scoreB: 0,
            isPlaying: false,
            startedAt: null,
            finishedAt: null,
          });
        }
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

  const handleFinishGame = (courtId: number) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    pushUndo({
      courts: structuredClone(useGameStore.getState().courts),
      players: structuredClone(usePlayerStore.getState().players),
      matchHistory: structuredClone(useGameStore.getState().matchHistory),
    });

    finishGame(courtId, court.scoreA, court.scoreB);

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
      court.restingPlayerIds.forEach((playerId) => {
        updatePlayer(playerId, { isResting: true });
      });
    }

    updateCourt(courtId, {
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
      handleContinuousNext(courtId);
    }
  };

  const handleContinuousNext = (courtId: number) => {
    try {
      const { courts: currentCourts, matchHistory: currentHistory, updateCourt: storeUpdateCourt, startGame: storeStartGame } = useGameStore.getState();
      const { players: currentPlayers } = usePlayerStore.getState();
      const { useStayDurationPriority: currentPriority } = useSettingsStore.getState();

      const currentPlayersInCourts = new Set(
        currentCourts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
      );

      const waitingPlayers = currentPlayers.filter(
        (p) => !p.isResting && !currentPlayersInCourts.has(p.id)
      );

      if (waitingPlayers.length < 4) {
        toast.error('待機中のプレイヤーが足りないため自動配置できません');
        return;
      }

      const allActivePlayers = currentPlayers.filter(p => !p.isResting);

      const assignments = assignCourts(
        waitingPlayers,
        1,
        currentHistory,
        {
          totalCourtCount: currentCourts.length,
          targetCourtIds: [courtId],
          practiceStartTime: session?.config.practiceStartTime,
          allPlayers: allActivePlayers,
          useStayDurationPriority: currentPriority,
        }
      );

      if (assignments[0]) {
        storeUpdateCourt(courtId, {
          teamA: assignments[0].teamA,
          teamB: assignments[0].teamB,
          scoreA: 0,
          scoreB: 0,
          isPlaying: false,
          startedAt: null,
          finishedAt: null,
        });
        storeStartGame(courtId);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '自動配置に失敗しました'
      );
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

  const activePlayers = sortWaitingPlayers(waitingPlayersUnsorted, {
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

  const unfinishedMatches = [...matchHistory]
    .reverse()
    .filter((m) => m.scoreA === 0 && m.scoreB === 0)
    .slice(0, 4);
  const visibleUnfinished = showAllUnfinished ? unfinishedMatches : unfinishedMatches.slice(0, 1);

  const emptyCourts = courts.filter(c => !c.teamA[0] || c.teamA[0] === '');
  const canAutoAssign = emptyCourts.length > 0 && activePlayers.length >= 4;

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
  };

  const handlePlayerTap = (
    playerId: string,
    courtId?: number,
    position?: number
  ) => {
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
    <div className="flex flex-col h-full bg-muted/30 font-sans relative overflow-hidden text-foreground">
      <header className="flex-none bg-background border-b border-border px-4 py-2.5 shadow-sm z-10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setContinuousMatchMode(!continuousMatchMode)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95 ${
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Users size={16} />
              <span>一括</span>
            </button>
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
              onClick={() => navigate('/history')}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted text-muted-foreground transition-colors"
            >
              <History size={18} />
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

      <main className="flex-1 overflow-y-auto pb-24 scrollbar-hide">
        {/* Courts Section */}
        <section className="py-4">
          <div className="flex overflow-x-auto gap-4 px-4 pb-4 scrollbar-hide">
            {courts.map((court) => {
              const hasPlayers = court.teamA[0] && court.teamA[0] !== '';
              const matchNumber = court.isPlaying && court.startedAt
                ? matchHistory.filter(m => m.finishedAt && m.finishedAt <= court.startedAt!).length + courts.filter(c => c.isPlaying && c.id < court.id).length + 1
                : null;

              return (
                <div key={court.id} className="flex-none w-[85vw] max-w-sm bg-card border border-border rounded-2xl shadow-sm snap-center flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        court.isPlaying ? 'bg-foreground text-background' : 'bg-muted-foreground text-white'
                      }`}>
                        {court.id}
                      </span>
                      <span className={`text-sm font-semibold ${!court.isPlaying && !hasPlayers ? 'text-muted-foreground' : ''}`}>
                        {court.isPlaying && matchNumber ? `試合 #${matchNumber}` : hasPlayers ? '準備中' : '空き'}
                      </span>
                    </div>
                    {court.isPlaying && court.startedAt && (
                      <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2 py-1 rounded-md text-xs font-mono font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2"/>
                        </svg>
                        <span>{formatElapsedTime(court.startedAt)}</span>
                      </div>
                    )}
                  </div>
                  
                  {hasPlayers ? (
                    <div className="p-4 flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 flex flex-col gap-2">
                          {court.teamA.map((playerId, idx) => {
                            const playerGender = getPlayerGender(playerId);
                            const textColor = playerGender === 'M' ? 'text-blue-600' : playerGender === 'F' ? 'text-pink-600' : 'text-muted-foreground';
                            return (
                              <button
                                key={idx}
                                onClick={() => handlePlayerTap(playerId, court.id, idx)}
                                className={`flex items-center justify-between bg-muted/30 p-2 rounded-lg border transition-colors ${
                                  selectedPlayer?.id === playerId
                                    ? 'border-primary bg-accent'
                                    : 'border-transparent hover:border-border'
                                }`}
                              >
                                <span className={`font-medium truncate text-sm ${textColor}`}>
                                  {getPlayerName(playerId)}
                                </span>
                                <span className="text-[10px] bg-background border px-1.5 rounded text-muted-foreground">
                                  {getPlayerGamesPlayed(playerId)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-col items-center justify-center px-1">
                          <span className="text-xs font-black text-muted-foreground/50">VS</span>
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          {court.teamB.map((playerId, idx) => {
                            const playerGender = getPlayerGender(playerId);
                            const textColor = playerGender === 'M' ? 'text-blue-600' : playerGender === 'F' ? 'text-pink-600' : 'text-muted-foreground';
                            return (
                              <button
                                key={idx}
                                onClick={() => handlePlayerTap(playerId, court.id, idx + 2)}
                                className={`flex items-center justify-between bg-muted/30 p-2 rounded-lg border transition-colors ${
                                  selectedPlayer?.id === playerId
                                    ? 'border-primary bg-accent'
                                    : 'border-transparent hover:border-border'
                                }`}
                              >
                                <span className={`font-medium truncate text-sm ${textColor}`}>
                                  {getPlayerName(playerId)}
                                </span>
                                <span className="text-[10px] bg-background border px-1.5 rounded text-muted-foreground">
                                  {getPlayerGamesPlayed(playerId)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      {court.isPlaying ? (
                        <button
                          onClick={() => handleFinishGame(court.id)}
                          className="w-full py-2.5 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                        >
                          <StopCircle size={18} />
                          終了
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleStartGame(court.id)}
                            className="flex-1 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                          >
                            <Play size={18} />
                            開始
                          </button>
                          <button
                            onClick={() => handleClearCourt(court.id)}
                            className="w-10 h-10 flex items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-muted-foreground mb-1">
                          <span className="font-bold">{court.id}</span>
                        </div>
                        <p className="text-sm text-muted-foreground font-medium">利用可能</p>
                      </div>
                      <button
                        onClick={() => handleAutoAssign(court.id)}
                        disabled={!canAutoAssign}
                        className="px-6 py-2 bg-white border border-border shadow-sm rounded-full text-sm font-medium text-primary flex items-center gap-2 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus size={16} />
                        配置
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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

        {/* Pending Scores */}
        <section className="px-4 mb-6">
          <div className="bg-orange-50 border border-orange-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between bg-orange-100/50">
              <div className="flex items-center gap-2 text-orange-800">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <h3 className="text-sm font-bold">スコア未入力</h3>
                {unfinishedMatches.length > 0 && (
                  <span className="text-xs bg-orange-200/50 px-1.5 py-0.5 rounded font-semibold">
                    {unfinishedMatches.length}
                  </span>
                )}
              </div>
              {unfinishedMatches.length > 1 && (
                <button 
                  onClick={() => setShowAllUnfinished(!showAllUnfinished)}
                  className="text-xs font-semibold text-orange-700 bg-white/50 px-2 py-1 rounded flex items-center gap-1 hover:bg-white/80 transition-colors"
                >
                  <span>{showAllUnfinished ? '閉じる' : `他${unfinishedMatches.length - 1}件`}</span>
                  <ChevronDown size={14} className={`transition-transform ${showAllUnfinished ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            {unfinishedMatches.length > 0 ? (
              <div className="divide-y divide-orange-100">
                {visibleUnfinished.map((match) => {
                  const teamANames = match.teamA.map(getPlayerName).join(' & ');
                  const teamBNames = match.teamB.map(getPlayerName).join(' & ');
                  const matchNumber = matchHistory.findIndex((m) => m.id === match.id) + 1;
                  const courtId = courts.find(c => 
                    c.teamA.includes(match.teamA[0]) || c.teamB.includes(match.teamA[0])
                  )?.id;
                  
                  return (
                    <div key={match.id} className="p-3 flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-orange-800/70">
                          <span className="font-mono">#{matchNumber}</span>
                          {courtId && (
                            <>
                              <span>•</span>
                              <span>コート {courtId}</span>
                            </>
                          )}
                        </div>
                        <div className="text-sm font-medium text-orange-950 truncate">
                          {teamANames} vs. {teamBNames}
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/score/${match.id}`, { state: { from: '/main' } })}
                        className="shrink-0 px-3 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs font-bold rounded-lg shadow-sm hover:bg-orange-50 transition-colors"
                      >
                        入力
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-sm text-orange-600/60 text-center">スコア未入力の試合がありません</div>
            )}
          </div>
        </section>

        {/* Waiting Players */}
        <section className="px-4 flex flex-col gap-6" ref={playerCardRef}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">待機中 ({activePlayers.length})</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {activePlayers.map((player) => {
                const isSelected = selectedPlayer?.id === player.id;
                
                return (
                  <button
                    key={player.id}
                    onClick={() => handlePlayerTap(player.id)}
                    className={`relative group bg-card border hover:border-primary/50 active:bg-accent/10 rounded-xl p-2 flex flex-col items-center gap-1.5 shadow-sm transition-all text-left ${
                      isSelected
                        ? 'ring-2 ring-primary ring-offset-1 border-primary'
                        : 'border-border'
                    }`}
                  >
                    {!isSelected && (
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleRestWithLock(player.id);
                          }}
                          className="w-5 h-5 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center"
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
                    <div className="w-full text-center">
                      <div className="text-xs font-semibold truncate text-foreground">{player.name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <span className="bg-muted px-1 rounded">{player.gender === 'M' ? '男' : player.gender === 'F' ? '女' : player.gender}</span>
                        <span>{player.gamesPlayed} 試合</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Member */}
          <div className="bg-card p-3 rounded-2xl border border-border flex gap-2 shadow-sm">
            <div className="flex-1 relative">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPlayerName.trim()) {
                    const parsed = parsePlayerInput(newPlayerName.trim(), /\s+/);
                    if (parsed) addPlayers([parsed]);
                    setNewPlayerName('');
                  }
                }}
                className="w-full h-10 pl-3 pr-3 bg-input border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="こば 男"
              />
            </div>
            <button
              onClick={() => {
                if (newPlayerName.trim()) {
                  const parsed = parsePlayerInput(newPlayerName.trim(), /\s+/);
                  if (parsed) addPlayers([parsed]);
                  setNewPlayerName('');
                }
              }}
              disabled={!newPlayerName.trim()}
              className="h-10 px-4 bg-secondary text-secondary-foreground rounded-xl font-semibold text-sm flex items-center gap-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed hover:bg-secondary/80 transition-colors"
            >
              <Plus size={16} />
              追加
            </button>
          </div>

          {/* On Break */}
          <div className="flex flex-col gap-3 pb-8">
            <h3 className="text-sm font-bold text-muted-foreground">休憩中 ({restingPlayers.length})</h3>
            {restingAndPlaceholderPlayers.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 opacity-75">
                {restingAndPlaceholderPlayers.map((player) => {
                  if (recentlyRestoredIds.has(player.id)) {
                    return <div key={player.id} className="relative bg-muted/50 border border-border rounded-xl p-2 flex flex-col items-center gap-1.5 shadow-sm" style={{ visibility: 'hidden' }} />;
                  }
                  const isSelected = selectedPlayer?.id === player.id;
                  return (
                    <button
                      key={player.id}
                      onClick={() => handlePlayerTap(player.id)}
                      className={`relative bg-muted/50 border rounded-xl p-2 flex flex-col items-center gap-1.5 shadow-sm ${
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-1 border-primary'
                          : 'border-border'
                      }`}
                    >
                      {!isSelected && (
                        <div className="absolute top-1 right-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleRestWithLock(player.id);
                            }}
                            className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center"
                          >
                            <ArrowUp className="w-3 h-3" />
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
                      <div className="w-full text-center">
                        <div className="text-xs font-semibold truncate text-muted-foreground">{player.name}</div>
                        <div className="text-[10px] text-muted-foreground">{player.gamesPlayed} 試合</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 pb-12">休憩メンバー無し</p>
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
    </div>
  );
}
