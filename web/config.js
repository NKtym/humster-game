window.APP_CONFIG = {
  apiBaseUrl: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api'
    : 'https://humster-game-docker.onrender.com/api',
};