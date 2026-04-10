module.exports = {
  apps: [
    {
      name: 'turnit-sync-main',
      script: './index.js',
      env: {
        NODE_ENV: 'production'
      },
      // You can further configure things like logging, restarts, etc. here if needed
      max_memory_restart: '1G'
    },
    {
      name: 'turnit-sync-cancellations',
      script: './index_cancellations.js',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '1G'
    }
  ]
};
