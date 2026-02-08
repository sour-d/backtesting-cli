import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';

dotenv.config();

class DataManager {
  constructor() {
    // Base directory
    this.dataRoot = process.env.DATA_ROOT || './.data';

    // Define directory structure
    this.directories = {
      market: process.env.MARKET_DATA_DIR || path.join(this.dataRoot, 'market'),
      technical: process.env.TECHNICAL_DATA_DIR || path.join(this.dataRoot, 'technical'),
      results: process.env.BACKTEST_RESULTS_DIR || path.join(this.dataRoot, 'results'),
      transformedResult: process.env.TRANSFORM_RESULT_DIR || path.join(this.dataRoot, 'transformedResult'),
      resultsStats: process.env.RESULTS_STATS_DIR || path.join(this.dataRoot, 'resultsStats'),
    };

    // Normalize all paths
    Object.keys(this.directories).forEach(key => {
      this.directories[key] = path.normalize(this.directories[key]);
    });
  }

  ensureDirectories() {
    const spinner = ora('Setting up data directories...').start();

    try {
      Object.entries(this.directories).forEach(([name, dir]) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          spinner.text = chalk.yellow(`Created ${name} directory: ${dir}`);
        }
      });

      spinner.succeed(chalk.green('Data directories ready'));

      // Log directory structure
      console.log(chalk.cyan('\n📁 Data Directory Structure:'));
      console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      Object.entries(this.directories).forEach(([name, dir]) => {
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
        console.log(`${chalk.bold(name.padEnd(12))}: ${chalk.green(dir)} ${chalk.dim(`(${files} files)`)}`);
      });
      console.log(chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      return true;
    } catch (error) {
      spinner.fail(chalk.red(`Failed to create directories: ${error.message}`));
      throw error;
    }
  }

  getFilePath(type, label) {
    const filename = `${label}.json`;
    return path.join(this.directories[type] || "", filename);
  }

  saveData = (filepath, data) => {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  };

  getMarketDataPath(label) {
    return this.getFilePath('market', label);
  }

  saveMarketData(symbolinfo, data) {
    const filepath = this.getFilePath("market", symbolinfo?.label);
    this.saveData(filepath, data);
  }

  getTechnicalDataPath(label) {
    return this.getFilePath('technical', label);
  }

  getResultsPath(label, suffix = '') {
    const filename = `${label}${suffix}.json`;
    return path.join(this.directories.results, filename);
  }

  getTransformedResultsPath(label) {
    const filename = `${label}.json`;
    return path.join(this.directories.transformedResult, filename);
  }
  getResultsStatsPath(label) {
    const filename = `${label}.json`;
    return path.join(this.directories.resultsStats, filename);
  }

  getOptimizationPath(label) {
    const filename = `${label}.json`;
    return path.join(this.directories.optimization, filename);
  }

  getModelPath(label, suffix = '') {
    const filename = `${label}${suffix}.json`;
    return path.join(this.directories.model, filename);
  }

  exists(filepath) {
    return fs.existsSync(filepath);
  }

  readJSON(filepath) {
    if (!this.exists(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    try {
      const content = fs.readFileSync(filepath, 'utf-8').trim();
      if (!content) {
        return null; // Empty file → treat as no data
      }
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse JSON from ${filepath}: ${error.message}`);
    }
  }

  writeJSON(filepath, data) {
    try {
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new Error(`Failed to write JSON to ${filepath}: ${error.message}`);
    }
  }

  appendToFile(filepath, data) {
    try {
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filepath, data, { flag: 'a' });
    } catch (error) {
      throw new Error(`Failed to append to ${filepath}: ${error.message}`);
    }
  }

  // Helper method to get directory structure info
  getDirectoryInfo() {
    return Object.entries(this.directories).map(([name, dir]) => ({
      name,
      path: dir,
      exists: fs.existsSync(dir),
      files: fs.existsSync(dir) ? fs.readdirSync(dir).length : 0
    }));
  }
}

// Create and export a singleton instance
const dataManager = new DataManager();
export default dataManager;
