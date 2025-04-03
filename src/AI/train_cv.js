import { LinearModel } from './core/model.js';
import { AIDataLoader } from './core/data_loader.js';
import ora from 'ora';
import dotenv from 'dotenv';

dotenv.config();
const symbol = process.env.DEFAULT_SYMBOL || 'BTCUSDT';
const interval = process.env.DEFAULT_INTERVAL || 'D';

/**
 * Splits data into training and validation sets.
 * @param {Array} data Array of processed data entries.
 * @param {number} valFraction Fraction of data to reserve for validation.
 * @returns {{trainData: Array, valData: Array}}
 */
function splitData(data, valFraction = 0.2) {
  const valSize = Math.floor(data.length * valFraction);
  const trainData = data.slice(0, data.length - valSize);
  const valData = data.slice(data.length - valSize);
  return { trainData, valData };
}

/**
 * Evaluates a model on validation data.
 * Uses absolute error as a placeholder metric.
 * @param {Object} model Trained model with a predict method.
 * @param {Array} data Validation dataset.
 * @returns {number} Average error across the validation set.
 */
function evaluateModel(model, data) {
  let errorSum = 0;
  let count = 0;
  data.forEach(entry => {
    const prediction = model.predict({
      price_change: entry.price_change,
      volatility: entry.volatility
    });
    // Using entry.close as a proxy target for error computation.
    const error = Math.abs(prediction - entry.close);
    errorSum += error;
    count++;
  });
  return errorSum / count;
}

/**
 * Runs multiple training iterations to select the best model based on validation error.
 */
async function crossValidateTraining() {
  const loader = new AIDataLoader(symbol, interval);
  loader.loadRawData();
  const data = loader.preprocess();
  
  if (data.length < 50) {
    console.error('Not enough data for training with validation.');
    return;
  }
  
  const { trainData, valData } = splitData(data);
  const numRuns = 5;
  let bestModel = null;
  let bestError = Infinity;
  
  for (let i = 0; i < numRuns; i++) {
    const spinner = ora(`Training run ${i + 1} of ${numRuns}`).start();
    const model = new LinearModel();
    // Assuming model.train() trains the model using the training data.
    await model.train(trainData);
    spinner.succeed(`Training run ${i + 1} complete`);
    const valError = evaluateModel(model, valData);
    console.log(`Validation error for run ${i + 1}: ${valError}`);
    if (valError < bestError) {
      bestError = valError;
      bestModel = model;
    }
  }
  
  console.log(`Best validation error: ${bestError}`);
  if (bestModel) {
    await bestModel.save();
    console.log('Best model saved successfully.');
  }
}

crossValidateTraining();
