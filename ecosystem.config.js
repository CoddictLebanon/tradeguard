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
      },
    },
    {
      name: 'tradeguard-web',
      cwd: './apps/web',
      script: 'npm',
      args: 'run dev',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
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
      },
    },
  ],
};
