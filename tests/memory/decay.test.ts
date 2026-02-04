/**
 * Tests for Memory Decay & Health System
 * 
 * Tests the Ebbinghaus forgetting curve implementation,
 * strength boosting, and health assessment functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  DECAY_CONFIG,
  calculateRetention,
  getRetentionLevel,
  calculateStrengthBoost,
  calculateDecayRate,
  projectRetention,
  getDecayStatus,
  generateHealthRecommendations,
} from '../../src/memory/decay.js';

describe('Memory Decay System', () => {
  // ============================================================================
  // Retention Calculation Tests
  // ============================================================================
  
  describe('calculateRetention', () => {
    it('should return 1.0 for just-accessed memory', () => {
      const now = new Date().toISOString();
      const retention = calculateRetention(now, 1.0, 0.5);
      assert.ok(retention > 0.99, `retention ${retention} should be > 0.99`);
    });

    it('should decay over time', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const retention = calculateRetention(oneHourAgo, 1.0, 0.5);
      assert.ok(retention < 1.0, `retention ${retention} should be < 1.0`);
      assert.ok(retention > 0.9, `retention ${retention} should be > 0.9`);
    });

    it('should decay faster with lower strength', () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const lowStrength = calculateRetention(sixHoursAgo, 0.5, 0.5);
      const highStrength = calculateRetention(sixHoursAgo, 3.0, 0.5);
      assert.ok(lowStrength < highStrength, `low ${lowStrength} should be < high ${highStrength}`);
    });

    it('should decay slower with higher importance', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const lowImportance = calculateRetention(oneDayAgo, 1.0, 0.2);
      const highImportance = calculateRetention(oneDayAgo, 1.0, 0.9);
      assert.ok(lowImportance < highImportance, `low ${lowImportance} should be < high ${highImportance}`);
    });

    it('should approach 50% at half-life for strength=1', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const retention = calculateRetention(oneDayAgo, 1.0, 0.5);
      assert.ok(retention > 0.4, `retention ${retention} should be > 0.4`);
      assert.ok(retention < 0.6, `retention ${retention} should be < 0.6`);
    });

    it('should never return negative values', () => {
      const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const retention = calculateRetention(longAgo, 0.1, 0.1);
      assert.ok(retention >= 0, `retention ${retention} should be >= 0`);
    });

    it('should never exceed 1.0', () => {
      const now = new Date().toISOString();
      const retention = calculateRetention(now, 10.0, 1.0);
      assert.ok(retention <= 1.0, `retention ${retention} should be <= 1.0`);
    });

    it('should handle critical importance (very slow decay)', () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const criticalRetention = calculateRetention(oneWeekAgo, 2.0, 0.95);
      assert.ok(criticalRetention > 0.4, `critical retention ${criticalRetention} should be > 0.4`);
    });
  });

  // ============================================================================
  // Retention Level Tests
  // ============================================================================

  describe('getRetentionLevel', () => {
    it('should return strong for high retention', () => {
      assert.strictEqual(getRetentionLevel(0.85), 'strong');
      assert.strictEqual(getRetentionLevel(1.0), 'strong');
    });

    it('should return moderate for medium retention', () => {
      assert.strictEqual(getRetentionLevel(0.6), 'moderate');
      assert.strictEqual(getRetentionLevel(0.75), 'moderate');
    });

    it('should return weak for low retention', () => {
      assert.strictEqual(getRetentionLevel(0.35), 'weak');
      assert.strictEqual(getRetentionLevel(0.45), 'weak');
    });

    it('should return forgotten for very low retention', () => {
      assert.strictEqual(getRetentionLevel(0.05), 'forgotten');
      assert.strictEqual(getRetentionLevel(0.25), 'forgotten');
    });

    it('should handle boundary values', () => {
      assert.strictEqual(getRetentionLevel(0.8), 'strong');
      assert.strictEqual(getRetentionLevel(0.5), 'moderate');
      assert.strictEqual(getRetentionLevel(0.3), 'weak');
    });
  });

  // ============================================================================
  // Strength Boost Tests
  // ============================================================================

  describe('calculateStrengthBoost', () => {
    it('should increase strength on recall', () => {
      const newStrength = calculateStrengthBoost(1.0, 0, 0.5);
      assert.ok(newStrength > 1.0, `strength ${newStrength} should be > 1.0`);
    });

    it('should have diminishing returns with more accesses', () => {
      const firstBoost = calculateStrengthBoost(1.0, 0, 0.5);
      const tenthBoost = calculateStrengthBoost(1.0, 10, 0.5);
      const boost1 = firstBoost - 1.0;
      const boost10 = tenthBoost - 1.0;
      assert.ok(boost10 < boost1, `boost10 ${boost10} should be < boost1 ${boost1}`);
    });

    it('should boost more for higher importance', () => {
      const lowImportanceBoost = calculateStrengthBoost(1.0, 0, 0.2);
      const highImportanceBoost = calculateStrengthBoost(1.0, 0, 0.9);
      assert.ok(highImportanceBoost > lowImportanceBoost, `high ${highImportanceBoost} should be > low ${lowImportanceBoost}`);
    });

    it('should not exceed MAX_STRENGTH', () => {
      const boosted = calculateStrengthBoost(9.5, 0, 1.0);
      assert.ok(boosted <= DECAY_CONFIG.MAX_STRENGTH, `boosted ${boosted} should be <= ${DECAY_CONFIG.MAX_STRENGTH}`);
    });

    it('should provide meaningful boost even for frequently accessed memories', () => {
      const boost = calculateStrengthBoost(1.0, 100, 0.5);
      assert.ok(boost > 1.0, `boost ${boost} should be > 1.0`);
    });
  });

  // ============================================================================
  // Decay Rate Tests
  // ============================================================================

  describe('calculateDecayRate', () => {
    it('should return higher rate for lower strength', () => {
      const lowStrengthRate = calculateDecayRate(0.5, 0.5);
      const highStrengthRate = calculateDecayRate(5.0, 0.5);
      assert.ok(lowStrengthRate > highStrengthRate, `low ${lowStrengthRate} should be > high ${highStrengthRate}`);
    });

    it('should return lower rate for higher importance', () => {
      const lowImportanceRate = calculateDecayRate(1.0, 0.2);
      const highImportanceRate = calculateDecayRate(1.0, 0.9);
      assert.ok(lowImportanceRate > highImportanceRate, `low ${lowImportanceRate} should be > high ${highImportanceRate}`);
    });

    it('should return positive rate', () => {
      const rate = calculateDecayRate(1.0, 0.5);
      assert.ok(rate > 0, `rate ${rate} should be > 0`);
    });
  });

  // ============================================================================
  // Projection Tests
  // ============================================================================

  describe('projectRetention', () => {
    it('should decrease over time', () => {
      const current = 0.8;
      const projected24h = projectRetention(current, 1.0, 0.5, 24);
      const projected7d = projectRetention(current, 1.0, 0.5, 168);
      assert.ok(projected24h < current, `24h ${projected24h} should be < current ${current}`);
      assert.ok(projected7d < projected24h, `7d ${projected7d} should be < 24h ${projected24h}`);
    });

    it('should decay slower with higher strength', () => {
      const current = 0.8;
      const lowStrength = projectRetention(current, 0.5, 0.5, 24);
      const highStrength = projectRetention(current, 5.0, 0.5, 24);
      assert.ok(lowStrength < highStrength, `low ${lowStrength} should be < high ${highStrength}`);
    });

    it('should return current retention at time 0', () => {
      const current = 0.75;
      const projected = projectRetention(current, 1.0, 0.5, 0);
      assert.ok(Math.abs(projected - current) < 0.00001, `projected ${projected} should be close to ${current}`);
    });
  });

  // ============================================================================
  // Decay Status Tests
  // ============================================================================

  describe('getDecayStatus', () => {
    it('should return complete status object', () => {
      const memory = {
        id: 'test-1',
        content: 'Test memory content',
        strength: 1.5,
        last_accessed: new Date().toISOString(),
        access_count: 5,
        importance: 0.6,
      };

      const status = getDecayStatus(memory);

      assert.strictEqual(status.id, 'test-1');
      assert.strictEqual(status.content, 'Test memory content');
      assert.strictEqual(status.strength, 1.5);
      assert.ok(status.retention > 0.9, `retention ${status.retention} should be > 0.9`);
      assert.strictEqual(status.retentionLevel, 'strong');
      assert.strictEqual(status.accessCount, 5);
      assert.strictEqual(status.importance, 0.6);
      assert.ok(status.decayRate > 0, `decayRate ${status.decayRate} should be > 0`);
      assert.ok(status.projectedRetention24h < status.retention, `24h ${status.projectedRetention24h} should be < retention ${status.retention}`);
      assert.ok(status.projectedRetention7d < status.projectedRetention24h, `7d ${status.projectedRetention7d} should be < 24h ${status.projectedRetention24h}`);
    });

    it('should flag memories needing review', () => {
      const weakMemory = {
        id: 'weak-1',
        content: 'Weak memory',
        strength: 0.3,
        last_accessed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        access_count: 1,
        importance: 0.3,
      };

      const status = getDecayStatus(weakMemory);
      assert.strictEqual(status.needsReview, true);
      assert.strictEqual(status.atRisk, true);
    });

    it('should not flag strong memories', () => {
      const strongMemory = {
        id: 'strong-1',
        content: 'Strong memory',
        strength: 5.0,
        last_accessed: new Date().toISOString(),
        access_count: 20,
        importance: 0.8,
      };

      const status = getDecayStatus(strongMemory);
      assert.strictEqual(status.needsReview, false);
      assert.strictEqual(status.atRisk, false);
    });
  });

  // ============================================================================
  // Health Recommendations Tests
  // ============================================================================

  describe('generateHealthRecommendations', () => {
    it('should recommend cleanup for many weak memories', () => {
      const health = {
        totalMemories: 100,
        atRiskCount: 5,
        needsReviewCount: 10,
        averageStrength: 2.0,
        strengthDistribution: { strong: 20, moderate: 30, weak: 30, forgotten: 20 },
      };

      const recommendations = generateHealthRecommendations(health);
      assert.ok(recommendations.some(r => r.includes('weak/forgotten')), 'should mention weak/forgotten');
    });

    it('should warn about memories at risk', () => {
      const health = {
        totalMemories: 100,
        atRiskCount: 15,
        needsReviewCount: 5,
        averageStrength: 2.0,
        strengthDistribution: { strong: 80, moderate: 15, weak: 3, forgotten: 2 },
      };

      const recommendations = generateHealthRecommendations(health);
      assert.ok(recommendations.some(r => r.includes('at risk')), 'should mention at risk');
    });

    it('should suggest review for low average strength', () => {
      const health = {
        totalMemories: 100,
        atRiskCount: 5,
        needsReviewCount: 5,
        averageStrength: 1.0,
        strengthDistribution: { strong: 30, moderate: 40, weak: 20, forgotten: 10 },
      };

      const recommendations = generateHealthRecommendations(health);
      assert.ok(recommendations.some(r => r.includes('Average strength')), 'should mention average strength');
    });

    it('should report good health when all metrics are good', () => {
      const health = {
        totalMemories: 100,
        atRiskCount: 2,
        needsReviewCount: 8,
        averageStrength: 3.5,
        strengthDistribution: { strong: 60, moderate: 30, weak: 8, forgotten: 2 },
      };

      const recommendations = generateHealthRecommendations(health);
      assert.ok(recommendations.some(r => r.includes('good')), 'should mention good health');
    });
  });

  // ============================================================================
  // Config Validation Tests
  // ============================================================================

  describe('DECAY_CONFIG', () => {
    it('should have valid threshold ordering', () => {
      const thresholds = DECAY_CONFIG.RETENTION_THRESHOLDS;
      assert.ok(thresholds.STRONG > thresholds.MODERATE, 'STRONG > MODERATE');
      assert.ok(thresholds.MODERATE > thresholds.WEAK, 'MODERATE > WEAK');
      assert.ok(thresholds.WEAK > thresholds.FORGOTTEN, 'WEAK > FORGOTTEN');
    });

    it('should have valid strength bounds', () => {
      assert.ok(DECAY_CONFIG.MIN_STRENGTH > 0, 'MIN_STRENGTH > 0');
      assert.ok(DECAY_CONFIG.MAX_STRENGTH > DECAY_CONFIG.MIN_STRENGTH, 'MAX > MIN');
      assert.ok(DECAY_CONFIG.INITIAL_STRENGTH >= DECAY_CONFIG.MIN_STRENGTH, 'INITIAL >= MIN');
      assert.ok(DECAY_CONFIG.INITIAL_STRENGTH <= DECAY_CONFIG.MAX_STRENGTH, 'INITIAL <= MAX');
    });

    it('should have positive decay constant', () => {
      assert.ok(DECAY_CONFIG.DECAY_CONSTANT > 0, 'DECAY_CONSTANT > 0');
    });

    it('should have valid importance multipliers', () => {
      const mult = DECAY_CONFIG.IMPORTANCE_MULTIPLIER;
      assert.ok(mult.LOW < mult.NORMAL, 'LOW < NORMAL');
      assert.ok(mult.NORMAL < mult.HIGH, 'NORMAL < HIGH');
      assert.ok(mult.HIGH < mult.CRITICAL, 'HIGH < CRITICAL');
    });
  });
});
