#!/bin/bash

# MainPage.tsx: gameModeの削除
sed -i "s/const isSingles = session?.config.gameMode === 'singles';/const isSingles = false; \/\/ ダブルス専用/g" src/pages/MainPage.tsx
sed -i "/gameMode: session?.config.gameMode,/d" src/pages/MainPage.tsx
sed -i "/gameMode: currentGameMode,/d" src/pages/MainPage.tsx
sed -i "s/const currentGameMode = useSessionStore.getState().session?.config.gameMode;//g" src/pages/MainPage.tsx

# ReservationPage.tsx: gameMode propsの削除
sed -i "/gameMode={session.config.gameMode}/d" src/pages/ReservationPage.tsx

# SessionCreate.tsx: GameModeの削除
sed -i "/import type { GameMode }/d" src/pages/SessionCreate.tsx
sed -i "/const gameMode: GameMode/d" src/pages/SessionCreate.tsx
sed -i "/gameMode,/d" src/pages/SessionCreate.tsx

# SettingsPage.tsx: GameModeの削除
sed -i "/import type { GameMode }/d" src/pages/SettingsPage.tsx
sed -i "/const currentMode: GameMode/d" src/pages/SettingsPage.tsx
sed -i "/updateConfig({ gameMode: newMode });/d" src/pages/SettingsPage.tsx
sed -i "s/const isSinglesMode = (session.config.gameMode || 'doubles') === 'singles';/const isSinglesMode = false; \/\/ ダブルス専用/g" src/pages/SettingsPage.tsx

# algorithm.ts: gameModeの削除
sed -i "/gameMode: options?.gameMode || 'doubles'/d" src/lib/algorithm.ts

echo "GameMode fixes applied"
