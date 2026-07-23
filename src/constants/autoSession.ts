/**
 * オートセッション作成関連の定数。
 *
 * Firebase 初期化（`../lib/firebase`）に依存するモジュールを一切 import しない。
 * `scripts/auto-create-session.ts` は Node/tsx 上で直接実行され、Vite の
 * `import.meta.env` を解決できないため、`src/lib/firebase.ts` を（間接的にでも）
 * import すると起動時に例外になる。この定数は sessionService.ts と
 * auto-create-session.ts の双方から安全に参照できるよう、ここに独立させている。
 */
export const AUTO_SESSION_BOT_CREATOR = 'auto-session-bot';
