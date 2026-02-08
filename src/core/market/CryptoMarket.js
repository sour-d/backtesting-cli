import { getInstrumentInfo, getAllInstruments } from "./InstrumentService.js";

class CryptoMarket {
  constructor() {
    this.instruments = {};
    this.initialized = false;
    this.interval = null;
    this.simulationStartTime = null;
    this.simulationEndTime = null;
  }

  async initializeWithAllInstruments() {
    console.log("  Fetching all instruments from exchange...");
    this.instruments = await getAllInstruments();

    // Load OHLC data for all fetched instruments
    for (const instrument of Object.values(this.instruments)) {
      await instrument.loadOHLCData();
    }

    this.initialized = true;
    await this.synchronizeMarketData();
    return this.instruments;
  }

  async initializeWithSpecificInstruments(instrumentNames) {
    this.instruments = {};

    for (const inst of instrumentNames) {
      try {
        const instrumentInfo = await getInstrumentInfo(inst.symbol);
        if (instrumentInfo) {
          this.instruments[inst.symbol] = instrumentInfo;
        }
      } catch (error) {
        console.error(`  Error loading ${inst.symbol}:`, error.message);
      }
    }

    this.initialized = true;
    await this.synchronizeMarketData();
    return this.instruments;
  }

  async synchronizeMarketData() {
    const instrumentsWithData = Object.values(this.instruments).filter(
      (inst) => inst.ohcl && inst.ohcl.length > 0
    );

    if (instrumentsWithData.length === 0) {
      console.warn("  No instruments have OHLC data available");
      return;
    }

    // Find the overlapping time window
    let latestStartTime = 0;
    let earliestEndTime = Infinity;

    instrumentsWithData.forEach((instrument) => {
      const firstCandle = instrument.ohcl[0];
      const lastCandle = instrument.ohcl[instrument.ohcl.length - 1];

      if (firstCandle && firstCandle.dateUnix > latestStartTime) {
        latestStartTime = firstCandle.dateUnix;
      }

      if (lastCandle && lastCandle.dateUnix < earliestEndTime) {
        earliestEndTime = lastCandle.dateUnix;
      }
    });

    this.simulationStartTime = latestStartTime;
    this.simulationEndTime = earliestEndTime;

    console.log(`  Data range: ${new Date(latestStartTime).toISOString().split("T")[0]} to ${new Date(earliestEndTime).toISOString().split("T")[0]}`);
    console.log(`  Instruments with data: ${instrumentsWithData.length}`);
  }

  setInterval(interval) {
    this.interval = interval;
  }

  isInitialized() {
    return this.initialized;
  }

  getAllInstruments() {
    return this.instruments;
  }

  getInstrument(symbol) {
    return this.instruments[symbol] || null;
  }

  getInstrumentCount() {
    return Object.keys(this.instruments).length;
  }

  getSimulationInfo() {
    return {
      startTime: this.simulationStartTime,
      endTime: this.simulationEndTime,
    };
  }
}

export { CryptoMarket };
export default CryptoMarket;
