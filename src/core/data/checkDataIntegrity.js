import fs from 'fs';
import path from 'path';
import symbols from '../../config/symbols.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../.data/market', symbols[0].label + '.json'), 'utf8'));

const expectedInterval = parseInt(symbols[0].interval, 10) * 1000 * 60; // Convert interval to integer and then to milliseconds

(function checkDataIntegrity() {
  const dailyDataMap = new Map();
  const expectedDailyCount = 60 * 24;

  for (let i = 0; i < data.length - 1; i++) {
    const current = data[i];
    const next = data[i + 1];

    if (next.dateUnix - current.dateUnix !== expectedInterval) {
      throw new Error(`Data gap detected between ${current.dateUnix} and ${next.dateUnix}: ${next.dateUnix - current.dateUnix} ms`);
    }

    const currentDay = new Date(current.dateUnix).toISOString().split('T')[0];
    if (!dailyDataMap.has(currentDay)) {
      dailyDataMap.set(currentDay, 0);
    }
    dailyDataMap.set(currentDay, dailyDataMap.get(currentDay) + 1);
  }

  dailyDataMap.forEach((count, day) => {
    console.log(`Day ${day} has ${count} data points.`);
    if (count !== expectedDailyCount) {
      console.warn(`Warning: Day ${day} is missing data. Expected ${expectedDailyCount}, but got ${count}.`);
    }
  });

  console.log('All data is present and consistent.');
})();
