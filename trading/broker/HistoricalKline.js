import dotenv from "dotenv";
import _ from "lodash";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import Client from "./Client.js";

// console.log("client", client);

dotenv.config();
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
  return response
    ? response.map((kline) => {
        return {
          date: dayjs(kline.datetime).format("YYYY-MM-DD"),
          time: dayjs(kline.datetime).format("HH:mm:ss"),
          dateUnix: dayjs(kline.datetime).tz("asia/kolkata").valueOf(),
          open: +kline.open,
          high: +kline.high,
          low: +kline.low,
          close: +kline.close,
          volume: +kline.volume,
        };
      })
    : [];
};

const HistoricalKline = async (
  symbol,
  interval,
  start,
  end,
  testnet = false
) => {
  const breezeClient = await Client();

  return await breezeClient
    .getHistoricalData({
      interval: interval, //'1minute', '5minute', '30minute','1day'
      fromDate: dayjs(start).toISOString(),
      toDate: dayjs(end).toISOString(),
      stockCode: symbol,
      exchangeCode: "NSE", // 'NSE','BSE','NFO'
      productType: "cash",
    })
    .then(function (resp) {
      return formatResponse(resp?.Success);
    })
    .catch(function (err) {
      console.log(err);
    });
};

export default HistoricalKline;
