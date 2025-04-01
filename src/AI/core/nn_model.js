import * as tf from '@tensorflow/tfjs-node';

export class NeuralNetwork {
  constructor() {
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({units: 8, activation: 'relu', inputShape: [2]}),
        tf.layers.dense({units: 4, activation: 'relu'}),
        tf.layers.dense({units: 1, activation: 'sigmoid'})
      ]
    });
    
    this.model.compile({
      optimizer: 'adam',
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });
  }

  async train(features, labels, epochs=100) {
    // Validate and prepare features
    if (!features.length || features.length !== labels.length) {
      throw new Error(`Feature/label mismatch: ${features.length} vs ${labels.length}`);
    }
    
    const values = [];
    for (const f of features) {
      if (typeof f?.price_change !== 'number' || typeof f?.volatility !== 'number') {
        throw new Error(`Invalid feature: ${JSON.stringify(f)}`);
      }
      values.push(f.price_change, f.volatility);
    }

    // Create tensors with explicit shape
    const xs = tf.tensor2d(values, [features.length, 2]);
    const ys = tf.tensor1d(labels);

    await this.model.fit(xs, ys, {
      epochs,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => 
          console.log(`Epoch ${epoch+1} - Loss: ${logs.loss.toFixed(4)}, Acc: ${logs.acc.toFixed(4)}`)
      }
    });
  }

  predict(feature) {
    if (typeof feature?.price_change !== 'number' || typeof feature?.volatility !== 'number') {
      return 0.5; // Neutral prediction for invalid data
    }
    return this.model.predict(
      tf.tensor2d([[feature.price_change, feature.volatility]])
    ).dataSync()[0];
  }

  async save(path='file://./ai_model') {
    await this.model.save(path);
  }

  async load(path='file://./ai_model') {
    this.model = await tf.loadLayersModel(path);
  }
}
