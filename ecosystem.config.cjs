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
  ],
};
