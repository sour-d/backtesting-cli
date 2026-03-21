/** @type {import('./src/config/loadConfig.js').QuantlabConfig} */
export default {
  symbols: [
    'SOLUSDT',
    'BTCUSDT',
    'ETHUSDT',
    'XRPUSDT',
    'DOGEUSDT',
    'ADAUSDT',
    'DOTUSDT',
    'AVAXUSDT',
  ],
  interval: '240',
  start: '2025-01-01 00:00',
  end: '2025-12-31 23:59',
  category: 'linear',
  strategy: 'MovingAverage_v2',
  capital: 100000,
  feeRate: 0.001,
};
