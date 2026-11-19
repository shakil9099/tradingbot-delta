// PM2: one instance, fork mode. Secrets come from .env (loaded by the app), never from this file.
module.exports = {
  apps: [
    {
      name: 'eth-bot',
      script: 'dist/index.js',
      cwd: __dirname, // .env, data/ and web/dist resolve from the repo root
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '300M',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 15000,
      env: { NODE_ENV: 'production', TZ: 'UTC' },
    },
    // Hull on PAPER for comparison (design_draft.md §6, 2026-11-20). Same build; these values override .env
    // (dotenv never overrides variables already set). Own data dir, lock and port; no keys, no Caddy route.
    {
      name: 'eth-hull-paper',
      script: 'dist/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '200M',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        TZ: 'UTC',
        DATA_DIR: 'data-hull',
        PORT: '3002',
        DRY_RUN: 'true',
        STRATEGY: 'hull',
        REV_REENTRY: 'true',
        BE_TRIG_USD: '0',
        FIXED_CONTRACTS: '100',
        PAPER_BALANCE: '200',
        DAY_LOSS_STOP: '0',
        CYCLE_OFFSET_SEC: '40',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_CHAT_ID: '',
      },
    },
  ],
};
