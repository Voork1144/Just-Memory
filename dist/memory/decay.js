"use strict";
/**
 * Just-Memory v2.2 - Memory Decay & Health System
 *
 * Implements Ebbinghaus forgetting curve for memory strength decay.
 *
 * Features:
 * - Memory strength decay over time (Ebbinghaus curve)
 * - Strength boost on access (spaced repetition)
 * - Automatic archival/cleanup of weak memories
 * - Memory health dashboard
 * - Decay status tools
 *
 * New tools (4):
 * - memory_decay_status: Get decay status for memories
 * - memory_health: Memory health dashboard
 * - memory_cleanup: Archive/delete weak memories
 * - memory_boost: Manually boost memory strength
 *
 * Research basis:
 * - Ebbinghaus (1885): Original forgetting curve
 * - NeuroDream (SSRN Dec 2024): 38% reduction in forgetting
 * - Spaced repetition: Strength increases with each recall
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECAY_TOOLS = exports.DECAY_CONFIG = void 0;
exports.calculateRetention = calculateRetention;
exports.getRetentionLevel = getRetentionLevel;
exports.calculateStrengthBoost = calculateStrengthBoost;
exports.calculateDecayRate = calculateDecayRate;
exports.projectRetention = projectRetention;
exports.getDecayStatus = getDecayStatus;
exports.getDecayStatusSQL = getDecayStatusSQL;
exports.getNeedsReviewSQL = getNeedsReviewSQL;
exports.getAtRiskSQL = getAtRiskSQL;
exports.getArchiveSQL = getArchiveSQL;
exports.getDeleteArchivedSQL = getDeleteArchivedSQL;
exports.getHealthStatsSQL = getHealthStatsSQL;
exports.getStrengthDistributionSQL = getStrengthDistributionSQL;
exports.getBoostStrengthSQL = getBoostStrengthSQL;
exports.generateHealthRecommendations = generateHealthRecommendations;
// ============================================================================
// Decay Constants - Based on Ebbinghaus Research
// ============================================================================
exports.DECAY_CONFIG = {
    // Base decay constant (higher = faster decay)
    // R(t) = e^(-t * λ / S) where λ = DECAY_CONSTANT, S = strength
    DECAY_CONSTANT: 0.693, // ln(2) - memory halves in ~1 day at strength=1
    // Strength bounds
    MIN_STRENGTH: 0.1,
    MAX_STRENGTH: 10.0,
    INITIAL_STRENGTH: 1.0,
    // Retention thresholds
    RETENTION_THRESHOLDS: {
        STRONG: 0.8, // Above 80% - well remembered
        MODERATE: 0.5, // 50-80% - needs review
        WEAK: 0.3, // 30-50% - at risk of forgetting
        FORGOTTEN: 0.1, // Below 30% - effectively forgotten
    },
    // Archival thresholds
    ARCHIVE_THRESHOLD: 0.2, // Archive below 20% retention
    DELETE_THRESHOLD: 0.05, // Delete below 5% retention
    // Strength boost on recall (spaced repetition)
    RECALL_BOOST: {
        BASE: 0.25, // Base strength increase per recall
        DIMINISHING: 0.05, // Diminishing returns factor
        MAX_BOOST: 2.0, // Max boost per recall
    },
    // Importance multipliers
    IMPORTANCE_MULTIPLIER: {
        LOW: 0.5, // importance < 0.3
        NORMAL: 1.0, // 0.3 <= importance < 0.7
        HIGH: 1.5, // 0.7 <= importance < 0.9
        CRITICAL: 3.0, // importance >= 0.9 (never decays fully)
    },
    // Cleanup settings
    CLEANUP: {
        MAX_ARCHIVED_AGE_DAYS: 90, // Delete archives older than this
        MIN_MEMORIES_TO_KEEP: 100, // Always keep at least this many
        BATCH_SIZE: 100, // Process in batches
    },
};
// ============================================================================
// Core Decay Functions
// ============================================================================
/**
 * Calculate memory retention using Ebbinghaus forgetting curve.
 * R(t) = e^(-t * λ / S) where:
 *   t = time since last access (hours)
 *   λ = decay constant
 *   S = memory strength
 */
function calculateRetention(lastAccessed, strength, importance = 0.5) {
    const lastAccessTime = typeof lastAccessed === 'string'
        ? new Date(lastAccessed).getTime()
        : lastAccessed.getTime();
    const hoursSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60);
    // Get importance multiplier
    let importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.NORMAL;
    if (importance < 0.3) {
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.LOW;
    }
    else if (importance >= 0.9) {
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.CRITICAL;
    }
    else if (importance >= 0.7) {
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.HIGH;
    }
    // Effective strength includes importance
    const effectiveStrength = Math.max(exports.DECAY_CONFIG.MIN_STRENGTH, strength * importanceMult);
    // Ebbinghaus formula
    const decayRate = exports.DECAY_CONFIG.DECAY_CONSTANT / (effectiveStrength * 24); // per hour
    const retention = Math.exp(-hoursSinceAccess * decayRate);
    return Math.max(0, Math.min(1, retention));
}
/**
 * Get retention level category
 */
function getRetentionLevel(retention) {
    if (retention >= exports.DECAY_CONFIG.RETENTION_THRESHOLDS.STRONG)
        return 'strong';
    if (retention >= exports.DECAY_CONFIG.RETENTION_THRESHOLDS.MODERATE)
        return 'moderate';
    if (retention >= exports.DECAY_CONFIG.RETENTION_THRESHOLDS.WEAK)
        return 'weak';
    return 'forgotten';
}
/**
 * Calculate new strength after recall (spaced repetition boost)
 */
function calculateStrengthBoost(currentStrength, accessCount, importance = 0.5) {
    // Diminishing returns: boost decreases with more accesses
    const boostFactor = exports.DECAY_CONFIG.RECALL_BOOST.BASE /
        (1 + exports.DECAY_CONFIG.RECALL_BOOST.DIMINISHING * accessCount);
    // Higher importance = bigger boost
    const importanceBoost = 1 + (importance - 0.5) * 0.5;
    const boost = Math.min(exports.DECAY_CONFIG.RECALL_BOOST.MAX_BOOST, boostFactor * importanceBoost);
    return Math.min(exports.DECAY_CONFIG.MAX_STRENGTH, currentStrength + boost);
}
/**
 * Calculate decay rate (how fast memory is decaying per hour)
 */
function calculateDecayRate(strength, importance = 0.5) {
    let importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.NORMAL;
    if (importance < 0.3)
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.LOW;
    else if (importance >= 0.9)
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.CRITICAL;
    else if (importance >= 0.7)
        importanceMult = exports.DECAY_CONFIG.IMPORTANCE_MULTIPLIER.HIGH;
    const effectiveStrength = strength * importanceMult;
    return exports.DECAY_CONFIG.DECAY_CONSTANT / (effectiveStrength * 24); // per hour
}
/**
 * Project retention at future time
 */
function projectRetention(currentRetention, strength, importance, hoursAhead) {
    const decayRate = calculateDecayRate(strength, importance);
    return currentRetention * Math.exp(-hoursAhead * decayRate);
}
// ============================================================================
// Decay Status Functions
// ============================================================================
/**
 * Get detailed decay status for a memory
 */
function getDecayStatus(memory) {
    const lastAccessTime = new Date(memory.last_accessed).getTime();
    const hoursSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60);
    const retention = calculateRetention(memory.last_accessed, memory.strength, memory.importance);
    const retentionLevel = getRetentionLevel(retention);
    const decayRate = calculateDecayRate(memory.strength, memory.importance);
    // Project future retention
    const projectedRetention24h = projectRetention(retention, memory.strength, memory.importance, 24);
    const projectedRetention7d = projectRetention(retention, memory.strength, memory.importance, 168);
    return {
        id: memory.id,
        content: memory.content,
        strength: memory.strength,
        retention,
        retentionLevel,
        lastAccessed: memory.last_accessed,
        hoursSinceAccess: Math.round(hoursSinceAccess * 10) / 10,
        accessCount: memory.access_count,
        importance: memory.importance,
        decayRate: Math.round(decayRate * 1000) / 1000,
        projectedRetention24h: Math.round(projectedRetention24h * 100) / 100,
        projectedRetention7d: Math.round(projectedRetention7d * 100) / 100,
        needsReview: retentionLevel === 'moderate' || retentionLevel === 'weak' || retentionLevel === 'forgotten',
        atRisk: retentionLevel === 'weak' || retentionLevel === 'forgotten',
    };
}
// ============================================================================
// SQL Generators for Just-Memory Integration
// ============================================================================
/**
 * Generate SQL for decay status tool
 */
function getDecayStatusSQL() {
    return `
    SELECT 
      id, content, strength, last_accessed, access_count, importance,
      project_id, type, tags, created_at
    FROM memories
    WHERE project_id = ? 
      AND deleted_at IS NULL
    ORDER BY last_accessed ASC
    LIMIT ?
  `;
}
/**
 * Generate SQL for memories needing review
 */
function getNeedsReviewSQL() {
    return `
    SELECT 
      id, content, strength, last_accessed, access_count, importance
    FROM memories
    WHERE project_id = ?
      AND deleted_at IS NULL
      AND (
        -- Weak strength
        strength < 2.0
        -- Or not accessed recently (> 7 days)
        OR last_accessed < datetime('now', '-7 days')
      )
    ORDER BY 
      -- Prioritize: low strength, old access, low importance
      strength ASC,
      last_accessed ASC,
      importance DESC
    LIMIT ?
  `;
}
/**
 * Generate SQL for memories at risk of being forgotten
 */
function getAtRiskSQL() {
    return `
    SELECT 
      id, content, strength, last_accessed, access_count, importance
    FROM memories
    WHERE project_id = ?
      AND deleted_at IS NULL
      AND strength < 1.0
      AND last_accessed < datetime('now', '-14 days')
    ORDER BY strength ASC, last_accessed ASC
    LIMIT ?
  `;
}
/**
 * Generate SQL for archiving weak memories
 */
function getArchiveSQL() {
    return `
    UPDATE memories
    SET deleted_at = datetime('now')
    WHERE id IN (
      SELECT id FROM memories
      WHERE project_id = ?
        AND deleted_at IS NULL
        AND strength < ?
        AND last_accessed < datetime('now', '-30 days')
        AND importance < 0.7
      ORDER BY strength ASC, last_accessed ASC
      LIMIT ?
    )
  `;
}
/**
 * Generate SQL for permanent deletion of old archives
 */
function getDeleteArchivedSQL() {
    return `
    DELETE FROM memories
    WHERE deleted_at IS NOT NULL
      AND deleted_at < datetime('now', '-? days')
      AND importance < 0.9
    LIMIT ?
  `;
}
/**
 * Generate SQL for memory health statistics
 */
function getHealthStatsSQL() {
    return `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as archived,
      AVG(CASE WHEN deleted_at IS NULL THEN strength ELSE NULL END) as avg_strength,
      MIN(CASE WHEN deleted_at IS NULL THEN last_accessed ELSE NULL END) as oldest_access,
      MAX(CASE WHEN deleted_at IS NULL THEN access_count ELSE NULL END) as max_access_count
    FROM memories
    WHERE project_id = ?
  `;
}
/**
 * Generate SQL for strength distribution
 */
function getStrengthDistributionSQL() {
    return `
    SELECT
      SUM(CASE WHEN strength >= 3.0 THEN 1 ELSE 0 END) as strong,
      SUM(CASE WHEN strength >= 1.5 AND strength < 3.0 THEN 1 ELSE 0 END) as moderate,
      SUM(CASE WHEN strength >= 0.5 AND strength < 1.5 THEN 1 ELSE 0 END) as weak,
      SUM(CASE WHEN strength < 0.5 THEN 1 ELSE 0 END) as forgotten
    FROM memories
    WHERE project_id = ? AND deleted_at IS NULL
  `;
}
/**
 * Generate SQL for boosting memory strength
 */
function getBoostStrengthSQL() {
    return `
    UPDATE memories
    SET 
      strength = MIN(?, strength + ?),
      access_count = access_count + 1,
      last_accessed = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `;
}
// ============================================================================
// Tool Definitions for MCP Server
// ============================================================================
exports.DECAY_TOOLS = [
    {
        name: 'memory_decay_status',
        description: 'Get decay/retention status for memories. Shows strength, retention level, projected forgetting.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: {
                    type: 'string',
                    enum: ['all', 'needs_review', 'at_risk', 'forgotten'],
                    default: 'all',
                    description: 'Filter memories by decay status'
                },
                limit: { type: 'number', default: 20, description: 'Max results' },
                project_id: { type: 'string', description: 'Project ID (optional)' }
            }
        }
    },
    {
        name: 'memory_health',
        description: 'Get memory system health dashboard with statistics and recommendations.',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: 'Project ID (optional)' }
            }
        }
    },
    {
        name: 'memory_cleanup',
        description: 'Archive or delete weak/forgotten memories. Use dry_run=true to preview.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['archive', 'delete', 'restore'],
                    default: 'archive',
                    description: 'Cleanup action'
                },
                dry_run: {
                    type: 'boolean',
                    default: true,
                    description: 'Preview without changes'
                },
                strength_threshold: {
                    type: 'number',
                    default: 0.3,
                    description: 'Archive memories below this strength'
                },
                days_inactive: {
                    type: 'number',
                    default: 30,
                    description: 'Archive if not accessed in this many days'
                },
                project_id: { type: 'string', description: 'Project ID (optional)' }
            }
        }
    },
    {
        name: 'memory_boost',
        description: 'Manually boost memory strength (simulates deliberate review).',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Memory ID to boost' },
                boost_amount: {
                    type: 'number',
                    default: 0.5,
                    description: 'Strength boost (0.1-2.0)'
                }
            },
            required: ['id']
        }
    }
];
// ============================================================================
// Health Recommendations Generator
// ============================================================================
function generateHealthRecommendations(health) {
    const recommendations = [];
    // Check for too many weak memories
    const weakPercent = (health.strengthDistribution.weak + health.strengthDistribution.forgotten) / health.totalMemories;
    if (weakPercent > 0.3) {
        recommendations.push(`⚠️ ${Math.round(weakPercent * 100)}% of memories are weak/forgotten. Consider reviewing important ones or running cleanup.`);
    }
    // Check for memories at risk
    if (health.atRiskCount > 10) {
        recommendations.push(`🔴 ${health.atRiskCount} memories at risk of being forgotten. Use memory_decay_status filter='at_risk' to see them.`);
    }
    // Check for memories needing review
    if (health.needsReviewCount > 20) {
        recommendations.push(`📝 ${health.needsReviewCount} memories need review. Recall important ones to strengthen them.`);
    }
    // Check average strength
    if (health.averageStrength < 1.5) {
        recommendations.push(`📉 Average strength is low (${health.averageStrength.toFixed(2)}). Increase recall frequency for important memories.`);
    }
    // Check for forgotten memories
    if (health.strengthDistribution.forgotten > 50) {
        recommendations.push(`🗑️ ${health.strengthDistribution.forgotten} forgotten memories. Run memory_cleanup to archive them.`);
    }
    // Good health
    if (recommendations.length === 0) {
        recommendations.push('✅ Memory health is good! Continue regular recall patterns.');
    }
    return recommendations;
}
exports.default = {
    DECAY_CONFIG: exports.DECAY_CONFIG,
    calculateRetention,
    getRetentionLevel,
    calculateStrengthBoost,
    calculateDecayRate,
    projectRetention,
    getDecayStatus,
    getDecayStatusSQL,
    getNeedsReviewSQL,
    getAtRiskSQL,
    getArchiveSQL,
    getDeleteArchivedSQL,
    getHealthStatsSQL,
    getStrengthDistributionSQL,
    getBoostStrengthSQL,
    DECAY_TOOLS: exports.DECAY_TOOLS,
    generateHealthRecommendations,
};
//# sourceMappingURL=decay.js.map