import Client from "../broker/Client.js";
import { Instrument } from "./Instrument.js";

const getInstrumentInfo = async (symbol) => {
  // For backtesting, create a mock instrument with the symbol
  // This avoids trying to fetch from exchange during backtesting
  try {
    const mockInstrumentData = {
      symbol: symbol,
      contractType: "LinearPerpetual",
      status: "Trading",
      baseCoin: symbol.replace("USDT", ""),
      quoteCoin: "USDT",
      launchTime: "0",
      deliveryTime: "0",
      deliveryFeeRate: "0",
      priceScale: "2",
      leverageFilter: {
        minLeverage: "1",
        maxLeverage: "100",
        leverageStep: "0.01"
      },
      priceFilter: {
        minPrice: "0.01",
        maxPrice: "1000000",
        tickSize: "0.01"
      },
      lotSizeFilter: {
        minOrderQty: "0.001",
        maxOrderQty: "25000000",
        qtyStep: "0.001",
        postOnlyMaxOrderQty: "250000000"
      },
      unifiedMarginTrade: true,
      fundingInterval: 480,
      settleCoin: "USDT",
      copyTrading: "none",
      upperFundingRate: "0.00375",
      lowerFundingRate: "-0.00375",
      isPreListing: false,
      preListingInfo: null
    };
    
    const instrument = new Instrument(mockInstrumentData);
    // Load OHLC data for the instrument
    await instrument.loadOHLCData();
    return instrument;
  } catch (error) {
    console.error(`Error creating mock instrument for ${symbol}:`, error);
    return null;
  }
};

const getAllInstruments = async () => {
  const client = await Client.getClient();
  console.log("Fetching all instruments from the exchange...");

  let allInstruments = {};
  let cursor = null;
  let hasNextPage = true;
  let totalCount = 0;

  while (hasNextPage) {
    const params = {
      category: "linear",
      limit: 1000
    };

    if (cursor) {
      params.cursor = cursor;
    }

    try {
      const response = await client.getInstrumentsInfo(params);
      const instruments = response.result.list;
      const nextPageCursor = response.result.nextPageCursor;

      instruments.forEach(inst => {
        const wrappedInstrument = new Instrument(inst);
        allInstruments[inst.symbol] = wrappedInstrument;
        totalCount++;
      });

      console.log(`Fetched ${instruments.length} instruments (Total: ${totalCount})`);

      if (nextPageCursor) {
        cursor = nextPageCursor;
      } else {
        hasNextPage = false;
      }
    } catch (error) {
      console.error("Error fetching instruments:", error);
      hasNextPage = false;
    }
  }

  console.log(`Total instruments fetched: ${totalCount}`);
  return allInstruments;
};

export { getInstrumentInfo, getAllInstruments };
