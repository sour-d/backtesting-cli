import * as tf from '@tensorflow/tfjs-node';

/**
 * Load a pre-trained model.
 * Example uses MobileNet as a feature extractor.
 */
export async function loadPretrainedModel() {
  // Load MobileNet. This URL points to a lightweight MobileNet version.
  const mobilenet = await tf.loadLayersModel(
    'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json'
  );
  return mobilenet;
}

/**
 * Build a complex neural network that combines a pre-trained base with custom layers.
 * @param {tf.LayersModel} pretrainedBase - The pre-trained model to use as a base.
 * @return {tf.LayersModel} - A new model combining the pre-trained base and custom layers.
 */
function buildComplexModel(pretrainedBase) {
  // Freeze the pre-trained layers.
  pretrainedBase.trainable = false;

  // Construct a new model on top of the pre-trained base.
  const model = tf.sequential();
  model.add(pretrainedBase);
  model.add(tf.layers.flatten());
  model.add(tf.layers.dense({
    units: 128,
    activation: 'relu'
  }));
  model.add(tf.layers.dropout({
    rate: 0.5
  }));
  // For binary classification, using 2 output units with softmax activation.
  model.add(tf.layers.dense({
    units: 2,
    activation: 'softmax'
  }));
  return model;
}

/**
 * Initialize the new AI model.
 * Loads the pre-trained model and builds the complex model on top of it.
 * @return {Promise<tf.LayersModel>} - The compiled new model.
 */
export async function initModel() {
  try {
    const pretrainedBase = await loadPretrainedModel();
    const model = buildComplexModel(pretrainedBase);
    model.compile({
      optimizer: tf.train.adam(),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    console.log('New model initialized and compiled successfully.');
    return model;
  } catch (error) {
    console.error('Error initializing the new model:', error);
  }
}

/**
 * Train the model with provided features and labels.
 * @param {tf.Tensor} features - The input features tensor.
 * @param {tf.Tensor} labels - The one-hot encoded labels tensor.
 * @return {Promise<tf.LayersModel>} - The trained model.
 */
export async function trainModel(features, labels) {
  const model = await initModel();
  await model.fit(features, labels, {
    epochs: 10,
    batchSize: 32,
    validationSplit: 0.2
  });
  console.log('Model training complete.');
  return model;
}
