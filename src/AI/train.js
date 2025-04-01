import { AIDataLoader } from './core/data_loader.js';
    import { LinearModel } from './core/model.js';
    import chalk from 'chalk';
    import ora from 'ora';

    const spinner = ora('Starting AI training').start();

    (async () => {
      try {
        // Load and prepare data
        const symbol = process.env.DEFAULT_SYMBOL || 'BTCUSDT';
        const interval = process.env.DEFAULT_INTERVAL || 'D';
        const loader = new AIDataLoader(symbol, interval);
        const processedData = loader.loadRawData().preprocess();
        spinner.info(`Found ${processedData.length} valid processed data points.`); // Log count
        if (processedData.length < 10) {
          throw new Error(`Need at least 10 valid records (found ${processedData.length})`);
        }

        // Create training data
        const features = [];
        const labels = [];
        for (let i = 0; i < processedData.length - 1; i++) {
          features.push(processedData[i]);
          labels.push(processedData[i + 1].close > processedData[i].close ? 1 : 0);
        }

        // Final validation before training
        const validFeatures = features.filter(f => f && typeof f.price_change === 'number' && typeof f.volatility === 'number');
        const validLabels = labels.filter(l => typeof l === 'number');

        if (validFeatures.length !== features.length || validLabels.length !== labels.length) {
            console.warn(`Data validation removed some entries. Features: ${features.length} -> ${validFeatures.length}, Labels: ${labels.length} -> ${validLabels.length}`);
        }
        if (validFeatures.length !== validLabels.length) {
            // Adjust labels to match valid features if lengths differ due to filtering
            const validIndices = features.map((f, idx) => f && typeof f.price_change === 'number' && typeof f.volatility === 'number' ? idx : -1).filter(idx => idx !== -1);
            const adjustedLabels = validIndices.map(idx => labels[idx]).filter(l => typeof l === 'number');

            if (validFeatures.length !== adjustedLabels.length) {
                 throw new Error(`Post-validation feature/label mismatch after adjustment: ${validFeatures.length} vs ${adjustedLabels.length}`);
            }
            console.warn(`Adjusted labels array to match valid features. New length: ${adjustedLabels.length}`);
             if (validFeatures.length < 10) {
                throw new Error(`Need at least 10 valid records after final validation (found ${validFeatures.length})`);
            }
            spinner.info(`Proceeding to train with ${validFeatures.length} valid feature/label pairs.`);
            // Train model using validated and adjusted data
            const model = new LinearModel();
            await model.train(validFeatures, adjustedLabels, 100); // Pass validated arrays
            await model.save();

        } else {
             if (validFeatures.length < 10) {
                throw new Error(`Need at least 10 valid records after final validation (found ${validFeatures.length})`);
            }
            spinner.info(`Proceeding to train with ${validFeatures.length} valid feature/label pairs.`);
            // Train model using validated data
            const model = new LinearModel();
            await model.train(validFeatures, validLabels, 100); // Pass validated arrays
            await model.save();
        }


        spinner.succeed(chalk.green('Training completed successfully'));
      } catch (error) {
        spinner.fail(chalk.red(`Training failed: ${error.message}`));
        process.exit(1);
      }
    })();
