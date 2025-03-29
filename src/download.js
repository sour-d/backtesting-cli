import dayjs from "dayjs";
import downloader from "../trading/stock_data/downloader.js";
import fs from "fs";
import _ from "lodash";

const getDateFormat = (date = dayjs().utc()) => {
  return dayjs(date);
};

const todaysDate = () => dayjs().utc().format("YYYY-MM-DD");

const getFilePath = (symbol, interval, isDefault = false) =>
  `./.output/data/${symbol}_${interval}${isDefault ? "_DEFAULT" : ""}.json`;

const downloadDefaultData = async () => {
  const symbol = process.env.DEFAULT_SYMBOL;
  const interval = process.env.DEFAULT_INTERVAL;
  const startDateString = process.env.DEFAULT_START_DATE + "T00:00:00.000Z";
  const endDateString = process.env.DEFAULT_END_DATE + "T23:59:59.999Z";
  console.log({
    symbol,
    interval,
    startDateString,
    endDateString,
  });

  const start = getDateFormat(startDateString);
  const end = getDateFormat(endDateString);

  if (fs.existsSync(getFilePath(symbol, interval, true))) {
    console.log("Deleting existing file");
    fs.unlinkSync(getFilePath(symbol, interval, true));
  }

  downloader(symbol, interval, start, end, getFilePath(symbol, interval, true));
};

const downloadFromLastDownloaded = async () => {
  const symbol = "BTCUSDT";
  const interval = "1";

  let start = getDateFormat(todaysDate());
  const end = getDateFormat();

  const filename = `./.output/data/${symbol}_${interval}.json`;
  if (fs.existsSync(filename)) {
    const data = JSON.parse(fs.readFileSync(filename));
    if (_.last(data)?.DateUnix) {
      start = getDateFormat(dayjs.utc(_.last(data).DateUnix).add(1, "minute"));
    }
  }

  downloader(symbol, interval, start, end);
};

const downloadFromStartEnd = (symbol, interval, startDate, endDate, filename) => {
  const start = getDateFormat(startDate + "T00:00:00.000Z");
  const end = getDateFormat((endDate || startDate) + "T23:59:59.999Z");
  const outputFilename = filename || getFilePath(symbol, interval);

  return downloader(symbol, interval, start, end, outputFilename);
};

// Export the functions to be used by the CLI
export { downloadDefaultData, downloadFromLastDownloaded, downloadFromStartEnd };
