import { RestClientV5 } from "bybit-api";
// import dotenv from "dotenv";
import _ from "lodash";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const restClient = (testnet) =>
  new RestClientV5({
    key: process.env.TESTNET_API_KEY,
    secret: process.env.TESTNET_API_SECRET,
    parseAPIRateLimits: true,
    testnet: testnet,
    // demoTrading: true,
  });

const getTimeFrame = (timeFrame) => {
  return {
    1: "hour",
    3: "hour",
    5: "hour",
    15: "hour",
    30: "hour",
    60: "day",
    D: "month",
  }[timeFrame];
};

const getNewEnd = (start, end, interval, addOneSecond = false) => {
  let newStart = start;
  if (addOneSecond) {
    newStart = dayjs(start).add(1, "second").valueOf();
  }
  const timeFrame = getTimeFrame(interval);
  const toAdd = interval < 60 ? 10 * interval : 10;
  const newEnd = dayjs(newStart)
    .add(toAdd, timeFrame)
    .subtract(1, "second")
    .valueOf();
  if (newEnd > end) {
    return end;
  }
  return newEnd;
};

const formatResponse = (response) => {
  return response.result.list
    .map((kline) => {
      return {
        date: dayjs(+kline[0])
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD"),
        time: dayjs(+kline[0])
          .tz("Asia/Kolkata")
          .format("HH:mm:ss"),
        dateUnix: +kline[0],
        open: +kline[1],
        high: +kline[2],
        low: +kline[3],
        close: +kline[4],
        volume: +kline[5],
      };
    })
    .reverse();
};

const HistoricalKline = async (
  symbol,
  interval,
  start,
  end,
  testnet = false
) => {
  const allData = [];
  const chunks = [];

  let fetchTill = getNewEnd(start, end, interval);
  while (end >= fetchTill) {
    chunks.push({ start, fetchTill });
    start = fetchTill;
    fetchTill = getNewEnd(start, end, interval, true);
    if (fetchTill === start) {
      fetchTill += 1;
    }
  }

  try {
    const results = await Promise.all(
      chunks.map(async ({ start, fetchTill }) => {
        const response = await restClient(testnet).getKline({
          symbol,
          interval,
          start,
          end: fetchTill,
          limit: 1000,
        });
        return formatResponse(response);
      })
    );

    results.forEach((data) => {
      allData.push(...data);
    });
  } catch (error) {
    console.log("error", JSON.stringify(error));
  }

  return allData;
};

export default HistoricalKline;