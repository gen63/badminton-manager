#!/bin/bash
# タイムスタンプのnullを0に変換
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/: null as number | null/: 0/g'
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/: null as number | undefined/: 0/g'
find src -name "*.test.ts" | xargs sed -i 's/lastPlayedAt: null/lastPlayedAt: 0/g'
find src -name "*.test.ts" | xargs sed -i 's/activatedAt: null/activatedAt: 0/g'
find src -name "*.test.ts" | xargs sed -i 's/startedAt: null/startedAt: 0/g'
find src -name "*.test.ts" | xargs sed -i 's/finishedAt: null/finishedAt: 0/g'

echo "Type fixes applied"
