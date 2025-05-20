# QuantLab Trading System

QuantLab is a comprehensive quantitative trading platform designed for downloading market data, backtesting trading strategies, and training AI models. It provides a robust command-line interface for seamless interaction.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Downloading Data](#downloading-data)
  - [Backtesting Strategies](#backtesting-strategies)
  - [Training Models](#training-models)
- [Code Structure](#code-structure)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Overview

QuantLab simplifies the process of quantitative trading by integrating data management, strategy simulation, and AI model training into a single platform.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd quantLab
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Set up the required data directories:
   ```bash
   yarn setup
   ```

## Configuration

Create a `.env` file in the project root with the following variables:

- `DEFAULT_SYMBOL`: Default trading symbol (e.g., BTCUSDT)
- `DEFAULT_INTERVAL`: Time interval for data (e.g., 1m, 1h, 1d)
- `DEFAULT_START_DATE`: Start date for data download (YYYY-MM-DD)
- `DEFAULT_END_DATE`: End date for data download (YYYY-MM-DD)

## Usage

### Downloading Data

To download historical market data:

```bash
yarn cli download --symbol BTCUSDT --interval 1h --start 2023-01-01 --end 2023-01-31
```

### Backtesting Strategies

Run a trading strategy on historical data:

```bash
yarn cli run <data-file> <strategy-name>
```

### Training Models

Train a reinforcement learning (RL) strategy:

```bash
yarn cli train <data-file> --epochs 50 --batch-size 64 --validation-split 0.2
```

## Code Structure

The project is organized as follows:

- **src/AI**: AI-related modules for training and backtesting.
  - `train.js`, `train_cv.js`: Scripts for training models.
  - `backtest.js`: Backtesting logic.
  - `core/`: Core AI utilities like `model.js` and `data_loader.js`.

- **src/cli**: Command-line interface for interacting with the system.
  - `index.js`: Entry point for CLI commands.
  - `download.js`: Handles data downloading.
  - `runStrategy.js`: Executes trading strategies.
  - `train.js`: Manages training processes.

- **src/core**: Core functionalities for data handling, indicators, and strategies.
  - `data/`: Data management utilities like `dataManager.js` and `downloader.js`.
  - `indicators/`: Technical indicators like ATR, Moving Averages, and SuperTrend.
  - `strategy/`: Trading strategies including Moving Average, Price Action, and RL-based strategies.
  - `tradeSimulator/`: Simulates trades and provides live quote data.

## Examples

1. Download data for BTCUSDT:
   ```bash
   yarn cli download --symbol BTCUSDT --interval 1h --start 2023-01-01 --end 2023-01-31
   ```

2. Run a backtest using the Moving Average Strategy:
   ```bash
   yarn cli run data/BTCUSDT.json MovingAverageStrategy
   ```

3. Train an RL strategy:
   ```bash
   yarn cli train data/BTCUSDT.json --epochs 100 --batch-size 32
   ```

## Contributing

Contributions are welcome! Please submit issues or pull requests. Ensure your code adheres to the project's style guidelines.

## License

This project is licensed under the MIT License.
