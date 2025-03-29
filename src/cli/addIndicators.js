import { addTechnicalIndicator } from "../trading/parser/restructureData.js";
import fs from "fs";
import _ from "lodash";

const INPUT_FOLDER = "./.output/data/";
const OUTPUT_FOLDER = "./.output/dataWithTechnicalIndicators/";

// const isRangeInvalid = (data, technicalData) => {
//   if (technicalData.length === 0) return false;

//   const lastTechnicalData = _.last(technicalData);
//   const lastData = _.last(data);
//   return (
//     lastTechnicalData.DateUnix > lastData.DateUnix ||
//     technicalData[0].DateUnix > data[0].DateUnix
//   );
// };

const main = () => {
  if (process.argv[2]) {
    const filename = process.argv[2];
    const inputFilePath = `${INPUT_FOLDER}${filename}.json`;
    const outputFilePath = `${OUTPUT_FOLDER}${filename}.json`;
    const data = JSON.parse(fs.readFileSync(inputFilePath));

    console.log(`adding total ${data.length} indicators`);

    const dataWithIndicators = addTechnicalIndicator(data);

    fs.writeFileSync(outputFilePath, JSON.stringify([...dataWithIndicators]), {
      encoding: "utf8",
    });
  }
};

main();
