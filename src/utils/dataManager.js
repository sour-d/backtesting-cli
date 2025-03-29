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
      optimization: process.env.OPTIMIZATION_DIR || path.join(this.dataRoot, 'optimization')
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

  getFilePath(type, symbol, interval, suffix = '') {
    if (!this.directories[type]) {
      throw new Error(`Invalid data type: ${type}`);
    }

    const filename = `${symbol}_${interval}${suffix}.json`;
    return path.join(this.directories[type], filename);
  }

  getMarketDataPath(symbol, interval, suffix = '') {
    return this.getFilePath('market', symbol, interval, suffix);
  }

  getTechnicalDataPath(symbol, interval, suffix = '') {
    return this.getFilePath('technical', symbol, interval, suffix);
  }

  getResultsPath(symbol, interval, strategy, suffix = '') {
    const filename = `${symbol}_${interval}_${strategy}${suffix}.json`;
    return path.join(this.directories.results, filename);
  }

  getOptimizationPath(symbol, interval, strategy, suffix = '') {
    const filename = `${symbol}_${interval}_${strategy}${suffix}.json`;
    return path.join(this.directories.optimization, filename);
  }

  exists(filepath) {
    return fs.existsSync(filepath);
  }

  readJSON(filepath) {
    if (!this.exists(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
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
