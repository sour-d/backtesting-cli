import chalk from 'chalk';

export class NeuralNetwork {
  constructor(hiddenLayers = [16, 8], learningRate = 0.001, decayRate = 0.999) {
    this.learningRate = learningRate;
    this.decayRate = decayRate;
    this.inputSize = 14; // 7 technical indicators + 7 pattern features
    this.hiddenLayers = hiddenLayers;
    
    // Initialize weights with proper structure
    this.weights = {
      w1: this.initLayer(this.inputSize, this.hiddenLayers[0]),
      b1: new Array(this.hiddenLayers[0]).fill(0.1),
      w2: this.initLayer(this.hiddenLayers[0], this.hiddenLayers[1]),
      b2: new Array(this.hiddenLayers[1]).fill(0.1),
      w3: this.initLayer(this.hiddenLayers[1], 1, true),
      b3: [0.1]
    };
    
    // Initialize Adam parameters
    this.beta1 = 0.9;
    this.beta2 = 0.999;
    this.epsilon = 1e-8;
    this.m = this.createAdamStructure();
    this.v = this.createAdamStructure();
    this.t = 1;
  }

  initLayer(inputSize, outputSize, isOutput = false) {
    const scale = Math.sqrt(2 / inputSize);
    if (isOutput) {
      return Array.from({length: inputSize}, () => 
        (Math.random() * 2 - 1) * scale);
    }
    return Array.from({length: inputSize}, () =>
      Array.from({length: outputSize}, () => 
        (Math.random() * 2 - 1) * scale));
  }

  createAdamStructure() {
    return {
      w1: this.weights.w1.map(layer => layer.map(() => 0)),
      b1: this.weights.b1.map(() => 0),
      w2: this.weights.w2.map(layer => layer.map(() => 0)),
      b2: this.weights.b2.map(() => 0),
      w3: this.weights.w3.map(() => 0),
      b3: [0]
    };
  }

  relu(x) {
    return Math.max(0, x);
  }

  sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  forward(inputs) {
    // Hidden layer 1
    this.h1 = Array.from({length: this.hiddenLayers[0]}, (_, j) => 
      this.relu(inputs.reduce((acc, val, i) => 
        acc + val * this.weights.w1[i][j], this.weights.b1[j]))
    );
    
    // Hidden layer 2
    this.h2 = Array.from({length: this.hiddenLayers[1]}, (_, j) => 
      this.relu(this.h1.reduce((acc, val, i) => 
        acc + val * this.weights.w2[i][j], this.weights.b2[j]))
    );

    // Output layer
    const output = this.h2.reduce((acc, val, i) => 
      acc + val * this.weights.w3[i], this.weights.b3[0]);
    return this.sigmoid(output);
  }

  adamUpdate(gradients) {
    this.t++;
    Object.keys(gradients).forEach(key => {
      if (key === 'b3') {
        const m = this.m[key][0] = this.beta1 * (this.m[key][0] || 0) + (1 - this.beta1) * gradients[key];
        const v = this.v[key][0] = this.beta2 * (this.v[key][0] || 0) + (1 - this.beta2) * gradients[key] ** 2;
        const mHat = m / (1 - Math.pow(this.beta1, this.t));
        const vHat = v / (1 - Math.pow(this.beta2, this.t));
        this.weights[key][0] += this.learningRate * mHat / (Math.sqrt(vHat) + this.epsilon);
      } else if (key.startsWith('w')) {
        gradients[key].forEach((layerGrad, i) => {
          if (Array.isArray(layerGrad)) {
            layerGrad.forEach((grad, j) => {
              const m = this.m[key][i][j] = this.beta1 * (this.m[key][i][j] || 0) + (1 - this.beta1) * grad;
              const v = this.v[key][i][j] = this.beta2 * (this.v[key][i][j] || 0) + (1 - this.beta2) * grad ** 2;
              const mHat = m / (1 - Math.pow(this.beta1, this.t));
              const vHat = v / (1 - Math.pow(this.beta2, this.t));
              this.weights[key][i][j] += this.learningRate * mHat / (Math.sqrt(vHat) + this.epsilon);
            });
          } else {
            const m = this.m[key][i] = this.beta1 * (this.m[key][i] || 0) + (1 - this.beta1) * layerGrad;
            const v = this.v[key][i] = this.beta2 * (this.v[key][i] || 0) + (1 - this.beta2) * layerGrad ** 2;
            const mHat = m / (1 - Math.pow(this.beta1, this.t));
            const vHat = v / (1 - Math.pow(this.beta2, this.t));
            this.weights[key][i] += this.learningRate * mHat / (Math.sqrt(vHat) + this.epsilon);
          }
        });
      } else {
        gradients[key].forEach((grad, i) => {
          const m = this.m[key][i] = this.beta1 * (this.m[key][i] || 0) + (1 - this.beta1) * grad;
          const v = this.v[key][i] = this.beta2 * (this.v[key][i] || 0) + (1 - this.beta2) * grad ** 2;
          const mHat = m / (1 - Math.pow(this.beta1, this.t));
          const vHat = v / (1 - Math.pow(this.beta2, this.t));
          this.weights[key][i] += this.learningRate * mHat / (Math.sqrt(vHat) + this.epsilon);
        });
      }
    });
  }

  train(features, labels, epochs = 500) {
    const inputs = features.map(sample => [
      sample.price_change * 100,
      sample.volatility * 100,
      (sample.rsi - 50) / 50,
      sample.ma20 / sample.close,
      sample.ma50 / sample.close,
      sample.momentum * 100,
      sample.volume_change * 100,
      sample.isDoji,
      sample.isHammer,
      sample.isEngulfing,
      sample.isMorningStar,
      sample.isThreeBlackCrows,
      sample.isPiercingLine,
      sample.isDarkCloudCover
    ]);

    const decayLR = () => this.learningRate *= this.decayRate;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      
      inputs.forEach((input, idx) => {
        const prediction = this.forward(input);
        const error = labels[idx] - prediction;
        epochLoss += error ** 2;

        // Backpropagation
        const delta3 = error * prediction * (1 - prediction);
        
        const delta2 = this.h2.map((h, j) => 
          h > 0 ? delta3 * this.weights.w3[j] : 0);
        
        const delta1 = this.h1.map((h, i) => 
          h > 0 ? this.weights.w2[i].reduce((acc, w, j) => 
            acc + w * delta2[j], 0) : 0);

        const gradients = {
          w3: this.weights.w3.map((w, j) => delta3 * this.h2[j]),
          b3: delta3,
          w2: this.weights.w2.map((layer, i) => 
            layer.map((w, j) => delta2[j] * this.h1[i])),
          b2: delta2,
          w1: this.weights.w1.map((layer, i) => 
            layer.map((w, j) => delta1[j] * input[i])),
          b1: delta1
        };

        this.adamUpdate(gradients);
      });

      decayLR();
      
      if (epoch % 100 === 0) {
        console.log(chalk.dim(`Epoch ${epoch}: Loss ${(epochLoss/inputs.length).toFixed(4)}`));
      }
    }
  }

  predict(feature) {
    const inputs = [
      feature.price_change * 100,
      feature.volatility * 100,
      (feature.rsi - 50) / 50,
      feature.ma20 / feature.close,
      feature.ma50 / feature.close,
      feature.momentum * 100,
      feature.volume_change * 100,
      feature.isDoji,
      feature.isHammer,
      feature.isEngulfing,
      feature.isMorningStar,
      feature.isThreeBlackCrows,
      feature.isPiercingLine,
      feature.isDarkCloudCover
    ];
    return this.forward(inputs);
  }
}
