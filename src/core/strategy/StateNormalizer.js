/**
 * State Normalizer for RL Strategy
 * Maintains running statistics and normalizes state values
 */

class StateNormalizer {
  constructor() {
    // Running statistics for each feature
    this.stats = {
      count: 0,
      mean: {},
      variance: {},
      min: {},
      max: {}
    };
  }

  // Update running statistics with new state
  update(state) {
    this.stats.count++;
    
    Object.entries(state).forEach(([key, value]) => {
      if (typeof value !== 'number') return;

      // Initialize if first update
      if (this.stats.count === 1) {
        this.stats.mean[key] = value;
        this.stats.variance[key] = 0;
        this.stats.min[key] = value;
        this.stats.max[key] = value;
        return;
      }

      // Update min/max
      this.stats.min[key] = Math.min(this.stats.min[key], value);
      this.stats.max[key] = Math.max(this.stats.max[key], value);

      // Update mean and variance using Welford's online algorithm
      const delta = value - this.stats.mean[key];
      this.stats.mean[key] += delta / this.stats.count;
      const delta2 = value - this.stats.mean[key];
      this.stats.variance[key] += delta * delta2;
    });
  }

  // Normalize state using running statistics
  normalize(state) {
    const normalized = {};

    Object.entries(state).forEach(([key, value]) => {
      if (typeof value !== 'number') {
        normalized[key] = value;
        return;
      }

      if (!(key in this.stats.mean)) {
        normalized[key] = value;
        return;
      }

      // Use min-max normalization for bounded features
      const boundedFeatures = ['ma20Trend', 'ma60Trend', 'superTrend', 'inPosition', 'positionType'];
      if (boundedFeatures.includes(key)) {
        normalized[key] = value; // These are already normalized
        return;
      }

      // Use z-score normalization for unbounded features
      const std = Math.sqrt(this.stats.variance[key] / (this.stats.count - 1));
      if (std === 0) {
        normalized[key] = 0;
      } else {
        normalized[key] = (value - this.stats.mean[key]) / std;
      }

      // Clip to reasonable range
      normalized[key] = Math.max(Math.min(normalized[key], 5), -5);
    });

    return normalized;
  }

  // Get feature statistics
  getStats() {
    const stats = {};
    Object.keys(this.stats.mean).forEach(key => {
      stats[key] = {
        mean: this.stats.mean[key],
        std: Math.sqrt(this.stats.variance[key] / (this.stats.count - 1)),
        min: this.stats.min[key],
        max: this.stats.max[key]
      };
    });
    return stats;
  }

  // Reset statistics
  reset() {
    this.stats = {
      count: 0,
      mean: {},
      variance: {},
      min: {},
      max: {}
    };
  }
}

export default StateNormalizer;
