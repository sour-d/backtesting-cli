import { describe, it, expect } from 'vitest';
import { calculateQuantity } from '../riskManager.js';

describe('calculateQuantity', () => {
  it('should calculate position size based on risk', () => {
    const qty = calculateQuantity({
      capital: 100000,
      riskPerStock: 5,
      price: 100,
      riskPercentage: 5,
      maxAllocation: 0.8,
    });

    expect(qty).toBeGreaterThan(0);
    expect(qty * 100).toBeLessThanOrEqual(100000 * 0.8);
  });

  it('should respect max allocation cap', () => {
    const qty = calculateQuantity({
      capital: 10000,
      riskPerStock: 0.01,
      price: 100,
      riskPercentage: 50,
      maxAllocation: 0.3,
    });

    expect(qty * 100).toBeLessThanOrEqual(10000 * 0.3 + 1);
  });

  it('should return 0 when capital is 0', () => {
    expect(calculateQuantity({
      capital: 0,
      riskPerStock: 5,
      price: 100,
      riskPercentage: 5,
      maxAllocation: 0.8,
    })).toBe(0);
  });

  it('should return 0 when risk per stock is 0', () => {
    expect(calculateQuantity({
      capital: 100000,
      riskPerStock: 0,
      price: 100,
      riskPercentage: 5,
      maxAllocation: 0.8,
    })).toBe(0);
  });

  it('should not exceed affordable quantity', () => {
    const qty = calculateQuantity({
      capital: 500,
      riskPerStock: 1,
      price: 100,
      riskPercentage: 100,
      maxAllocation: 1.0,
    });

    expect(qty * 100).toBeLessThanOrEqual(500);
  });
});
