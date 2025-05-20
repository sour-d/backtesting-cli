import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const ts = (date, time = "00:00") => {
  const dateTime = dayjs(date + " " + time);
  return dateTime.tz("Asia/Kolkata").valueOf();
}

export default [
  {
    label: "BTC_BULL_1_MARKET_1d_2023",
    symbol: "BTCUSDT",
    start: ts("2023-01-01"),
    end: ts("2023-12-01"),
    interval: "60",
    tag: ["Bull market"]
  },
]