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
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

export default [
  {
    label: "BTC_BULL_MARKET_1d_2023",
    symbol: "BTCUSDT",
    start: ts("2023-01-01"),
    end: ts("2023-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bull market"]
  },
  {
    label: "GALA_BEAR_MARKET_1d_2023",
    symbol: "GALAUSDT",
    start: ts("2023-01-01"),
    end: ts("2023-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bear market"]
  }
]