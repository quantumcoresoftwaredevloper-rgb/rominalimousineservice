export default {
  apps: [
    {
      // MUST be unique across the whole box. ellicottcityairporttaxi.com already
      // runs as `ellicott-api` under this same PM2 daemon (/root/.pm2). Reusing a
      // name would make `pm2 reload` kill the other site's API.
      name: 'romina-api',
      cwd: './server',
      // scripts/start.sh sources .env in the shell before exec'ing node. PM2
      // spawns the app from the daemon's own environment, and passport builds
      // its JwtStrategy at module load — so an env that is not already exported
      // surfaces as `TypeError: JwtStrategy requires a secret or key`.
      script: 'scripts/start.sh',
      // MUST stay 1: Socket.io rooms are per-process and there is no Redis
      // adapter, so 2+ cluster workers silently drop live tracking / driver
      // feed / notification events for sockets on the other worker.
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 5002,
      },
      env_production: {
        NODE_ENV: 'production',
        // 5001 is taken by ellicott-api on this VPS.
        PORT: 5002,
      },
      max_memory_restart: '350M',
      exp_backoff_restart_delay: 100,
      // Relative to cwd (./server) so this works for any SSH user / path.
      error_file: './logs/romina-api-error.log',
      out_file: './logs/romina-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      autorestart: true,
      watch: false,
      max_restarts: 10,
    },
  ],
};