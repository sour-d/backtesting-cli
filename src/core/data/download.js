import symbolConfig from "../../config/symbols.js";
import downloader from "./downloader.js";
import aiSymbolConfig from "../../config/aiTrainingSymbols.js";

const download = async (downlaodAiSymbols = false) => {
  const symbolInfos = downlaodAiSymbols ? aiSymbolConfig : symbolConfig;
  const allData = symbolInfos.map((symbolInfo) => {
    return new Promise((resolve, reject) => {
      downloader(symbolInfo)
        .then(() => {
          resolve();
        })
        .catch((error) => {
          console.error(`Error downloading data for ${symbolInfo?.label}:`, error);
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