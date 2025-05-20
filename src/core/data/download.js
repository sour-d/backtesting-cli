import symbolConfig from "../../config/symbols.js";
import downloader from "./downloader.js";

const download = async () => {
  const allData = symbolConfig.map((symbolinfo) => {
    return new Promise((resolve, reject) => {
      downloader(symbolinfo)
        .then(() => {
          resolve();
        })
        .catch((error) => {
          console.error(`Error downloading data for ${symbolinfo?.label}:`, error);
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