import InstrumentsInfo from "../../config/symbols.js";
import downloader from "../data/downloader.js";
import dataManager from "../data/dataManager.js";

export const getOHLCData = async (symbols) => {
  const instrumentInfo = {
    symbol: symbols,
    interval: InstrumentsInfo.interval,
    start: InstrumentsInfo.start,
    end: InstrumentsInfo.end,
    label: `${symbols}_${InstrumentsInfo.interval}`,
  };
  
  try {
    // First try to load existing data
    const filepath = dataManager.getMarketDataPath(instrumentInfo.label);
    if (dataManager.exists(filepath)) {
      const existingData = dataManager.readJSON(filepath);
      if (existingData && existingData.length > 0) {
        console.log(`Loaded existing data for ${symbols}: ${existingData.length} candles`);
        return existingData;
      }
    }
    
    // If no existing data, download it
    console.log(`No existing data found for ${symbols}, downloading...`);
    await downloader(instrumentInfo);
    
    // Load the newly downloaded data
    const newData = dataManager.readJSON(filepath);
    return newData || [];
  } catch (error) {
    console.error(`Error loading OHLC data for ${symbols}:`, error);
    return [];
  }
};

class Instrument {
  constructor(instrumentData) {
    this.symbol = instrumentData.symbol;
    this.contractType = instrumentData.contractType;
    this.status = instrumentData.status;
    this.baseCoin = instrumentData.baseCoin;
    this.quoteCoin = instrumentData.quoteCoin;
    this.launchTime = instrumentData.launchTime;
    this.deliveryTime = instrumentData.deliveryTime;
    this.deliveryFeeRate = instrumentData.deliveryFeeRate;
    this.priceScale = instrumentData.priceScale;
    this.leverageFilter = instrumentData.leverageFilter;
    this.priceFilter = instrumentData.priceFilter;
    this.lotSizeFilter = instrumentData.lotSizeFilter;
    this.unifiedMarginTrade = instrumentData.unifiedMarginTrade;
    this.fundingInterval = instrumentData.fundingInterval;
    this.settleCoin = instrumentData.settleCoin;
    this.copyTrading = instrumentData.copyTrading;
    this.upperFundingRate = instrumentData.upperFundingRate;
    this.lowerFundingRate = instrumentData.lowerFundingRate;
    this.isPreListing = instrumentData.isPreListing;
    this.preListingInfo = instrumentData.preListingInfo;
    this.rawData = instrumentData;
    this.ohcl = [];
    this.dataLoaded = false;
  }

  async loadOHLCData() {
    if (!this.dataLoaded) {
      try {
        this.ohcl = await getOHLCData(this.symbol);
        this.dataLoaded = true;
      } catch (error) {
        console.error(`Error loading OHLC data for ${this.symbol}:`, error);
        this.ohcl = [];
      }
    }
    return this.ohcl;
  }

  isActive() {
    return this.status === "Trading";
  }

  isPreListed() {
    return this.status === "PreLaunch" || this.isPreListing;
  }

  getMinPrice() {
    return this.priceFilter?.minPrice ? +this.priceFilter.minPrice : 0;
  }

  getMaxPrice() {
    return this.priceFilter?.maxPrice ? +this.priceFilter.maxPrice : Infinity;
  }

  getTickSize() {
    return this.priceFilter?.tickSize ? +this.priceFilter.tickSize : 0;
  }

  getMinOrderSize() {
    return this.lotSizeFilter?.minOrderQty
      ? +this.lotSizeFilter.minOrderQty
      : 0;
  }

  getMaxOrderSize() {
    return this.lotSizeFilter?.maxOrderQty
      ? +this.lotSizeFilter.maxOrderQty
      : Infinity;
  }

  getMinLeverage() {
    return this.leverageFilter?.minLeverage
      ? +this.leverageFilter.minLeverage
      : 1;
  }

  getMaxLeverage() {
    return this.leverageFilter?.maxLeverage
      ? +this.leverageFilter.maxLeverage
      : 1;
  }

  toString() {
    return `${this.symbol} (${this.baseCoin}/${this.quoteCoin}) - ${this.status}`;
  }

  toJSON() {
    return {
      symbol: this.symbol,
      contractType: this.contractType,
      status: this.status,
      baseCoin: this.baseCoin,
      quoteCoin: this.quoteCoin,
      isActive: this.isActive(),
      isPreListed: this.isPreListed(),
      minPrice: this.getMinPrice(),
      maxPrice: this.getMaxPrice(),
      tickSize: this.getTickSize(),
      minOrderSize: this.getMinOrderSize(),
      maxOrderSize: this.getMaxOrderSize(),
      minLeverage: this.getMinLeverage(),
      maxLeverage: this.getMaxLeverage(),
    };
  }
}

export { Instrument };
export default Instrument;
