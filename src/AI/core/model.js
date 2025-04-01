export class LinearModel {
  constructor() {
    // Stable weight initialization
    this.weights = {
      price_change: (Math.random() * 0.02) - 0.01,
      volatility: (Math.random() * 0.02) - 0.01,
      bias: 0
    };
  }

  async train(features, labels, learningRate = 0.01, epochs = 200) {
    // Compute normalization parameters and store in model
    const validSamples = features.filter(
      s => typeof s.price_change === 'number' && typeof s.volatility === 'number'
    );
    let sumPrice = 0, sumVol = 0;
    validSamples.forEach(s => { sumPrice += s.price_change; sumVol += s.volatility; });
    const meanPrice = sumPrice / validSamples.length;
    const meanVol = sumVol / validSamples.length;
    let squaredPrice = 0, squaredVol = 0;
    validSamples.forEach(s => {
      squaredPrice += (s.price_change - meanPrice) ** 2;
      squaredVol += (s.volatility - meanVol) ** 2;
    });
    const stdPrice = Math.sqrt(squaredPrice / validSamples.length) || 1;
    const stdVol = Math.sqrt(squaredVol / validSamples.length) || 1;
    
    this.featureMean = { price_change: meanPrice, volatility: meanVol };
    this.featureStd = { price_change: stdPrice, volatility: stdVol };
    
    // Normalize training features
    const normFeatures = features.map(s => ({
      price_change: (s.price_change - meanPrice) / stdPrice,
      volatility: (s.volatility - meanVol) / stdVol
    }));
    
    let bestLoss = Infinity;
    let epochsNoImprove = 0;
    let patience = 20;
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalError = 0;
      let totalAbsoluteError = 0;
      let validCount = 0;
      let currentLR = learningRate * Math.pow(0.99, epoch);
    
      normFeatures.forEach((sample, idx) => {
        const prediction = this.predict(sample);
        const error = labels[idx] - prediction;
    
        // Update weights without gradient clipping for stronger learning signal
        this.weights.price_change += currentLR * error * sample.price_change;
        this.weights.volatility += currentLR * error * sample.volatility;
        this.weights.bias += currentLR * error;
    
        totalError += error ** 2;
        totalAbsoluteError += Math.abs(error);
        validCount++;
      });
    
      if (validCount > 0) {
        const mse = totalError / validCount;
        const mae = totalAbsoluteError / validCount;
        if (epoch % 20 === 0) {
          console.log(`Epoch ${epoch} - MSE: ${mse.toFixed(4)} - MAE: ${mae.toFixed(4)} - LR: ${currentLR.toFixed(5)}`);
        }
        if (mse < bestLoss) {
          bestLoss = mse;
          epochsNoImprove = 0;
        } else {
          epochsNoImprove++;
        }
        if (epochsNoImprove >= patience) {
          console.log(`Early stopping at epoch ${epoch} with MSE: ${mse.toFixed(4)}`);
          break;
        }
      }
    }
    return this;
  }

  predict(feature) {
    if (!feature || typeof feature.price_change !== 'number' || typeof feature.volatility !== 'number') {
      return 0.5;
    }
    const raw = feature.price_change * this.weights.price_change +
                feature.volatility * this.weights.volatility +
                this.weights.bias;
    // Amplify the raw output further to obtain a more sensitive prediction
    const clamped = Math.max(-20, Math.min(20, raw));
    return 1 / (1 + Math.exp(- (clamped * 20)));
  }

  async save(path = 'ai_model_v1.json') {
    const fs = await import('fs/promises');
    const modelData = {
      weights: this.weights,
      featureMean: this.featureMean || null,
      featureStd: this.featureStd || null,
      timestamp: new Date().toISOString()
    };
    await fs.writeFile(path, JSON.stringify(modelData, null, 2));
  }

  async load(path = 'ai_model_v1.json') {
    const fs = await import('fs/promises');
    const data = JSON.parse(await fs.readFile(path, 'utf-8'));
    this.weights = data.weights;
    this.featureMean = data.featureMean;
    this.featureStd = data.featureStd;
  }
}
