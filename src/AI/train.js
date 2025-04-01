import { AIDataLoader } from './core/data_loader.js';
import { NeuralNetwork } from './core/model.js';
import chalk from 'chalk';
import ora from 'ora';

const spinner = ora('Starting AI training pipeline').start();

try {
  // 1. Data loading
  spinner.text = 'Loading market data';
  const loader = new AIDataLoader();
  const rawData = loader.loadRawData();
  spinner.succeed(`📂 Loaded ${rawData.data.length} historical records`);

  // 2. Preprocessing
  spinner.start('Processing raw data');
  const processedData = loader.preprocess();
  spinner.succeed(`🛠️  Created ${processedData.length} normalized samples`);
  console.log(chalk.dim(`First sample preview: ${JSON.stringify(processedData[0], null, 2)}`));

  // 3. Prepare training data
  spinner.start('Creating training dataset');
  const features = [];
  const labels = [];
  
  for (let i = 0; i < processedData.length - 1; i++) {
    features.push(processedData[i]);
    labels.push(processedData[i + 1].close > processedData[i].close ? 1 : 0);
  }
  spinner.succeed(`🎯 Created training set (${features.length} samples)`);

  // 4. Model initialization
  spinner.start('Initializing neural network');
  const model = new NeuralNetwork([16, 8]); // Explicit hidden layers
  spinner.succeed(`🧠 Created NN with ${model.hiddenLayers.join('→')} hidden units`);

  // 5. Training
  spinner.start('Training model').info();
  model.train(features, labels);
  
  // 6. Evaluation
  spinner.start('Evaluating model performance');
  let correct = 0;
  features.forEach((sample, idx) => {
    const prediction = model.predict(sample);
    if ((prediction > 0.5 && labels[idx] === 1) || (prediction <= 0.5 && labels[idx] === 0)) {
      correct++;
    }
  });
  const accuracy = (correct / features.length * 100).toFixed(1);
  
  const testSample = features[features.length - 1];
  const prediction = model.predict(testSample);
  const confidence = (prediction * 100).toFixed(1);
  const actual = labels[labels.length - 1];
  
  spinner.succeed(chalk.green('✅ Training complete'));
  console.log(chalk.dim('════════════════════════════════════════'));
  console.log(`📈 ${chalk.bold('Training Accuracy:')} ${chalk.yellow(accuracy + '%')}`);
  console.log(`🔮 ${chalk.bold('Final Prediction:')} ${chalk.cyan(confidence + '% confidence')}`);
  console.log(`📉 ${chalk.bold('Actual Movement:')} ${actual === 1 ? chalk.green('Up') : chalk.red('Down')}`);
  console.log(chalk.dim('════════════════════════════════════════'));

} catch (error) {
  spinner.fail(chalk.red(`💥 Training failed: ${error.message}`));
  process.exit(1);
}
