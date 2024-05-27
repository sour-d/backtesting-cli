import { HistoricalKline } from "broker";
import fs from "fs";

const downloader = async (symbol, interval, start, end, filePath) => {
  const startMs = start.valueOf();
  const endMs = end.valueOf();
  const OHCL = await HistoricalKline(symbol, interval, startMs, endMs, false);

  console.log({ start: start["$d"], end: end["$d"], startMs, endMs });

  console.log(`${OHCL.length} records downloaded from ${start} to ${end}}`);

  let newData = OHCL;
  const fileNameWithPath =
    filePath || `./.output/data/${symbol}_${interval}.json`;

  if (fs.existsSync(fileNameWithPath)) {
    const data = JSON.parse(fs.readFileSync(fileNameWithPath));
    console.log(`Existing data found, appending ${data.length} records`);
    newData = [...data, ...OHCL];
  }
  fs.writeFileSync(fileNameWithPath, JSON.stringify(newData));
};

export default downloader;
