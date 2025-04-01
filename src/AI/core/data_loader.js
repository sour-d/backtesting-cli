import { readFileSync } from 'fs';
    import dataManager from '../../utils/dataManager.js';

    export class AIDataLoader {
      constructor(symbol = 'BTCUSDT', interval = 'D') {
        this.symbol = symbol;
        this.interval = interval;
        this.data = null;
      }

      loadRawData() {
        const path = dataManager.getMarketDataPath(this.symbol, this.interval);
        try {
          this.data = JSON.parse(readFileSync(path));
          console.log(`Loaded ${this.data?.length || 0} raw entries from ${path}`);
        } catch (e) {
          console.error(`Failed to load or parse data from ${path}: ${e}`);
          this.data = [];
        }
        return this;
      }

      preprocess() {
        console.log(`Preprocessing ${this.data?.length || 0} entries...`);
        let keptCount = 0;
        const processed = this.data
          .map((entry, index, arr) => {
            // Log first 5 raw entries
            if (index > 0 && index < 6) {
                console.log(`Raw entry ${index}:`, JSON.stringify(entry), ` Prev Close: ${arr[index-1]?.close}`); // Use lowercase 'close'
            }
            try {
              if (index < 1 || !entry || !arr[index-1]) return null;
              const prev = arr[index-1];

              // Validate numerical values & denominators are positive and finite using lowercase properties
              if (!prev || prev.close <= 0 || entry.high <= entry.low || entry.low <= 0 ||
                  !Number.isFinite(prev.close) || !Number.isFinite(entry.high) || !Number.isFinite(entry.low) || !Number.isFinite(entry.close)) {
                 if (index > 0 && index < 11) console.log(`Filtering entry ${index}: Invalid base values (Close=${entry.close}, High=${entry.high}, Low=${entry.low}, PrevClose=${prev.close})`); // Use lowercase
                return null;
              }

              const rawPriceChange = (entry.close - prev.close)/prev.close; // Use lowercase
              const rawVolatility = (entry.high - entry.low)/entry.low; // Use lowercase

              // Log first 5 calculated raw features
              if (index > 0 && index < 6) {
                  console.log(`Raw features ${index}: PriceChange=${rawPriceChange?.toFixed(6)}, Volatility=${rawVolatility?.toFixed(6)}`);
              }

              // Filter only non-finite numbers
              if (!Number.isFinite(rawPriceChange) || !Number.isFinite(rawVolatility)) {
                 if (index > 0 && index < 11) console.log(`Filtering entry ${index}: Non-finite raw features`);
                return null;
              }

              const priceChange = Math.tanh(rawPriceChange * 3);
              const volatility = Math.tanh(rawVolatility * 2);

              if (!Number.isFinite(priceChange) || !Number.isFinite(volatility)) {
                 if (index > 0 && index < 11) console.log(`Filtering entry ${index}: Non-finite tanh features`);
                return null;
              }

              keptCount++;
              return {
                date: entry.dateUnix, // Keep original case if it's correct
                close: entry.close, // Use lowercase
                price_change: priceChange,
                volatility: volatility
              };
            } catch (error) {
               console.error(`Error processing entry ${index}:`, error);
              return null;
            }
          })
          .filter(entry => entry !== null);

          console.log(`Finished preprocessing. Kept ${processed.length} entries (Internal count: ${keptCount}).`);
          return processed;
      }
    }
