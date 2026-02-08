import symbolConfig from "../../config/symbols.js";
import downloader from "./downloader.js";

const download = async () => {
  const { instruments, interval, start, end } = symbolConfig;
  const allData = instruments.map((symbol) => {
    return new Promise((resolve, reject) => {
      downloader({ symbol, interval, start, end, label: `${symbol}_${interval}` })
        .then(() => {
          resolve();
        })
        .catch((error) => {
          console.error(`Error downloading data for ${symbol}:`, error);
          reject(error);
        });
    });
  });

  console.log("Starting downloading data...");
  Promise.all(allData).then(() => {
    console.log("All data downloaded successfully.");
  }).catch((error) => {
    console.error("Error downloading some data:", error);
  }
  );
};

export default download;
