import fs from "fs";
import strategies from "../trading/strategy/index.js";

const findStrategy = (strategies, name) => {
  return strategies.find((s) => s.name === name);
};

const persistResult = (filename) => (result) => {
  const path = "./.output/result/";
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
  fs.writeFileSync(`${path}${filename}`, JSON.stringify(result, null, 2));
  console.log(`Saved data in ${path}${filename}`);
};

export const runStrategy = async (filename, strategyName) => {
  // Validate inputs
  if (!filename) {
    throw new Error('Filename is required');
  }
  if (!strategyName) {
    throw new Error('Strategy name is required');
  }

  // Validate file exists and is readable
  if (!fs.existsSync(filename)) {
    throw new Error(`Input file not found: ${filename}`);
  }

  // Find strategy
  const strategyClass = findStrategy(strategies, strategyName);
  if (!strategyClass) {
    throw new Error(`Strategy not found: ${strategyName}`);
  }

  try {
    console.log(`Running strategy "${strategyName}" on file "${filename}"...`);

    const strategyInstance = new strategyClass(
      filename,
      persistResult(`${filename}.json`),
      strategyClass.getDefaultConfig()
    );

    await strategyInstance.execute();
    console.log(`Strategy "${strategyName}" completed successfully.`);
  } catch (error) {
    console.error(`Strategy execution failed:`, error);
    throw error; // Re-throw to be handled by CLI
  }
};
