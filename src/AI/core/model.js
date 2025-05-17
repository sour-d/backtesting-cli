import * as tf from '@tensorflow/tfjs-node';

export class TFBacktestModel {
  constructor() {
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({
          units: 8,
          activation: 'relu',
          inputShape: [2],
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dense({
          units: 4,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid'
        })
      ]
    });

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    this.featureMean = { price_change: 0, volatility: 0 };
    this.featureStd = { price_change: 1, volatility: 1 };
  }

  async train(features, labels, epochs = 100, batchSize = 32) {
    // Convert features to normalized tensors
    const { normalizedFeatures, featureMean, featureStd } = this.normalizeFeatures(features);
    this.featureMean = featureMean;
    this.featureStd = featureStd;

    const featureTensor = tf.tensor2d(
      normalizedFeatures.map(f => [f.price_change, f.volatility])
    );
    const labelTensor = tf.tensor2d(labels, [labels.length, 1]);

    // Add early stopping
    const earlyStopping = tf.callbacks.earlyStopping({
      monitor: 'loss',
      patience: 5,
      minDelta: 0.001
    });

    await this.model.fit(featureTensor, labelTensor, {
      epochs,
      batchSize,
      validationSplit: 0.2,
      callbacks: [earlyStopping],
      verbose: 1
    });

    // Cleanup tensors
    featureTensor.dispose();
    labelTensor.dispose();
  }

  predict(feature) {
    if (!feature || typeof feature.price_change !== 'number' || typeof feature.volatility !== 'number') {
      return 0.5;
    }
    
    // Normalize input
    const normalized = {
      price_change: (feature.price_change - this.featureMean.price_change) / this.featureStd.price_change,
      volatility: (feature.volatility - this.featureMean.volatility) / this.featureStd.volatility
    };

    const tensor = tf.tensor2d([[normalized.price_change, normalized.volatility]]);
    const prediction = this.model.predict(tensor).dataSync()[0];
    tensor.dispose();
    
    return prediction;
  }

  async save(path = 'ai_model_v1') {
    await this.model.save(`file://${path}`);
  }

  async load(path = 'ai_model_v1') {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
  }

  normalizeFeatures(features) {
    const validFeatures = features.filter(
      f => typeof f.price_change === 'number' && typeof f.volatility === 'number'
    );

    // Calculate mean and std
    const priceChanges = validFeatures.map(f => f.price_change);
    const volatilities = validFeatures.map(f => f.volatility);
    
    const priceMean = tf.mean(priceChanges).dataSync()[0];
    const priceStd = tf.moments(priceChanges).variance.sqrt().dataSync()[0] || 1;
    const volMean = tf.mean(volatilities).dataSync()[0];
    const volStd = tf.moments(volatilities).variance.sqrt().dataSync()[0] || 1;

    // Normalize features
    const normalized = validFeatures.map(f => ({
      price_change: (f.price_change - priceMean) / priceStd,
      volatility: (f.volatility - volMean) / volStd
    }));

    return {
      normalizedFeatures: normalized,
      featureMean: { price_change: priceMean, volatility: volMean },
      featureStd: { price_change: priceStd, volatility: volStd }
    };
  }
}
