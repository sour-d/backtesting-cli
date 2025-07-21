
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
    label: "BTC_1d_2023",
    symbol: "BTCUSDT",
    start: ts("2021-01-01"),
    end: ts("2024-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bull market"]
  },
  {
    label: "GALA_1d_2023",
    symbol: "GALAUSDT",
    start: ts("2021-01-01"),
    end: ts("2024-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bear market"]
  },
  {
    label: "SOL_1d_2023",
    symbol: "SOLUSDT",
    start: ts("2021-01-01"),
    end: ts("2024-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bear market"]
  },
  {
    label: "ETH_1d_2023",
    symbol: "ETHUSDT",
    start: ts("2021-01-01"),
    end: ts("2024-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bear market"]
  },
  {
    label: "XRP_1d_2023",
    symbol: "XRPUSDT",
    start: ts("2021-01-01"),
    end: ts("2024-12-31", "23:59"),
    interval: intervals['1d'],
    tag: ["Bear market"]
  },
]