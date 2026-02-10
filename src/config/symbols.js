import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const ts = (date, time = "00:00") => {
  const dateTime = dayjs(date + " " + time);
  return dateTime.tz("Asia/Kolkata").valueOf();
};

const intervals = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

export default {
  start: ts("2025-01-01"),
  end: ts("2025-12-31", "23:59"),
  interval: intervals["1d"],
  instruments: [
    "BTCUSDT",   // Bitcoin
    "ETHUSDT",   // Ethereum
    "SOLUSDT",   // Solana
    "ADAUSDT",   // Cardano
    "DOGEUSDT",  // Dogecoin
    "XRPUSDT",   // Ripple
    "DOTUSDT",   // Polkadot
    "AVAXUSDT",  // Avalanche
    "MATICUSDT", // Polygon
    "LTCUSDT",   // Litecoin
  ],
};
