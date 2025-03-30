/**
 * Experience Replay Buffer for RL Strategy
 * Stores and samples (state, action, reward, next_state) tuples
 */

class ReplayBuffer {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.buffer = [];
    this.position = 0;
  }

  push(state, action, reward, nextState) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push({ state, action, reward, nextState });
    } else {
      this.buffer[this.position] = { state, action, reward, nextState };
    }
    this.position = (this.position + 1) % this.maxSize;
  }

  sample(batchSize) {
    if (this.buffer.length < batchSize) {
      return this.buffer;
    }

    const indices = new Array(batchSize).fill(0).map(() => 
      Math.floor(Math.random() * this.buffer.length)
    );

    return indices.map(i => this.buffer[i]);
  }

  clear() {
    this.buffer = [];
    this.position = 0;
  }

  get size() {
    return this.buffer.length;
  }
}

export default ReplayBuffer;
