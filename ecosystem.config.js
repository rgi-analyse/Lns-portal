module.exports = {
  apps: [
    {
      name: 'lns-api',
      script: 'apps/api/dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '1G',
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: 'lns-portal',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: 'apps/portal',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: 'logs/portal-error.log',
      out_file: 'logs/portal-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '1G',
    },
  ],
};
