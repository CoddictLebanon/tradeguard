module.exports = {
  apps: [
    {
      name: 'tradeguard-api',
      cwd: './apps/api',
      script: 'npm',
      args: 'run dev',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
        PORT: '3667',
      },
    },
    {
      name: 'tradeguard-web',
      cwd: './apps/web',
      script: 'npm',
      args: 'run start',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '3666',
      },
    },
    {
      name: 'ib-proxy',
      cwd: './ib-proxy',
      script: 'proxy.py',
      interpreter: '/home/xcoder/Desktop/Claude/TradeGuard/ib-proxy/venv/bin/python',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        IB_PROXY_PORT: '6680',
        IB_PROXY_API_KEY: '880c7a362729f226a75ae0d3ba4a9069f69f145042623933ac0198c68a7063b8',
      },
    },
  ],
};
