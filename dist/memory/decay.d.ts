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
export declare const DECAY_CONFIG: {
    DECAY_CONSTANT: number;
    MIN_STRENGTH: number;
    MAX_STRENGTH: number;
    INITIAL_STRENGTH: number;
    RETENTION_THRESHOLDS: {
        STRONG: number;
        MODERATE: number;
        WEAK: number;
        FORGOTTEN: number;
    };
    ARCHIVE_THRESHOLD: number;
    DELETE_THRESHOLD: number;
    RECALL_BOOST: {
        BASE: number;
        DIMINISHING: number;
        MAX_BOOST: number;
    };
    IMPORTANCE_MULTIPLIER: {
        LOW: number;
        NORMAL: number;
        HIGH: number;
        CRITICAL: number;
    };
    CLEANUP: {
        MAX_ARCHIVED_AGE_DAYS: number;
        MIN_MEMORIES_TO_KEEP: number;
        BATCH_SIZE: number;
    };
};
export interface DecayStatus {
    id: string;
    content: string;
    strength: number;
    retention: number;
    retentionLevel: 'strong' | 'moderate' | 'weak' | 'forgotten';
    lastAccessed: string;
    hoursSinceAccess: number;
    accessCount: number;
    importance: number;
    decayRate: number;
    projectedRetention24h: number;
    projectedRetention7d: number;
    needsReview: boolean;
    atRisk: boolean;
}
export interface MemoryHealth {
    totalMemories: number;
    activeMemories: number;
    archivedMemories: number;
    strengthDistribution: {
        strong: number;
        moderate: number;
        weak: number;
        forgotten: number;
    };
    averageRetention: number;
    averageStrength: number;
    oldestAccess: string;
    mostAccessedId: string;
    leastAccessedId: string;
    atRiskCount: number;
    needsReviewCount: number;
    recommendations: string[];
}
export interface CleanupResult {
    archived: number;
    deleted: number;
    preserved: number;
    errors: string[];
    duration_ms: number;
}
/**
 * Calculate memory retention using Ebbinghaus forgetting curve.
 * R(t) = e^(-t * λ / S) where:
 *   t = time since last access (hours)
 *   λ = decay constant
 *   S = memory strength
 */
export declare function calculateRetention(lastAccessed: string | Date, strength: number, importance?: number): number;
/**
 * Get retention level category
 */
export declare function getRetentionLevel(retention: number): 'strong' | 'moderate' | 'weak' | 'forgotten';
/**
 * Calculate new strength after recall (spaced repetition boost)
 */
export declare function calculateStrengthBoost(currentStrength: number, accessCount: number, importance?: number): number;
/**
 * Calculate decay rate (how fast memory is decaying per hour)
 */
export declare function calculateDecayRate(strength: number, importance?: number): number;
/**
 * Project retention at future time
 */
export declare function projectRetention(currentRetention: number, strength: number, importance: number, hoursAhead: number): number;
/**
 * Get detailed decay status for a memory
 */
export declare function getDecayStatus(memory: {
    id: string;
    content: string;
    strength: number;
    last_accessed: string;
    access_count: number;
    importance: number;
}): DecayStatus;
/**
 * Generate SQL for decay status tool
 */
export declare function getDecayStatusSQL(): string;
/**
 * Generate SQL for memories needing review
 */
export declare function getNeedsReviewSQL(): string;
/**
 * Generate SQL for memories at risk of being forgotten
 */
export declare function getAtRiskSQL(): string;
/**
 * Generate SQL for archiving weak memories
 */
export declare function getArchiveSQL(): string;
/**
 * Generate SQL for permanent deletion of old archives
 */
export declare function getDeleteArchivedSQL(): string;
/**
 * Generate SQL for memory health statistics
 */
export declare function getHealthStatsSQL(): string;
/**
 * Generate SQL for strength distribution
 */
export declare function getStrengthDistributionSQL(): string;
/**
 * Generate SQL for boosting memory strength
 */
export declare function getBoostStrengthSQL(): string;
export declare const DECAY_TOOLS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            filter: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
            action?: undefined;
            dry_run?: undefined;
            strength_threshold?: undefined;
            days_inactive?: undefined;
            id?: undefined;
            boost_amount?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            project_id: {
                type: string;
                description: string;
            };
            filter?: undefined;
            limit?: undefined;
            action?: undefined;
            dry_run?: undefined;
            strength_threshold?: undefined;
            days_inactive?: undefined;
            id?: undefined;
            boost_amount?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            action: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            dry_run: {
                type: string;
                default: boolean;
                description: string;
            };
            strength_threshold: {
                type: string;
                default: number;
                description: string;
            };
            days_inactive: {
                type: string;
                default: number;
                description: string;
            };
            project_id: {
                type: string;
                description: string;
            };
            filter?: undefined;
            limit?: undefined;
            id?: undefined;
            boost_amount?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            id: {
                type: string;
                description: string;
            };
            boost_amount: {
                type: string;
                default: number;
                description: string;
            };
            filter?: undefined;
            limit?: undefined;
            project_id?: undefined;
            action?: undefined;
            dry_run?: undefined;
            strength_threshold?: undefined;
            days_inactive?: undefined;
        };
        required: string[];
    };
})[];
export declare function generateHealthRecommendations(health: {
    totalMemories: number;
    atRiskCount: number;
    needsReviewCount: number;
    averageStrength: number;
    strengthDistribution: {
        strong: number;
        moderate: number;
        weak: number;
        forgotten: number;
    };
}): string[];
declare const _default: {
    DECAY_CONFIG: {
        DECAY_CONSTANT: number;
        MIN_STRENGTH: number;
        MAX_STRENGTH: number;
        INITIAL_STRENGTH: number;
        RETENTION_THRESHOLDS: {
            STRONG: number;
            MODERATE: number;
            WEAK: number;
            FORGOTTEN: number;
        };
        ARCHIVE_THRESHOLD: number;
        DELETE_THRESHOLD: number;
        RECALL_BOOST: {
            BASE: number;
            DIMINISHING: number;
            MAX_BOOST: number;
        };
        IMPORTANCE_MULTIPLIER: {
            LOW: number;
            NORMAL: number;
            HIGH: number;
            CRITICAL: number;
        };
        CLEANUP: {
            MAX_ARCHIVED_AGE_DAYS: number;
            MIN_MEMORIES_TO_KEEP: number;
            BATCH_SIZE: number;
        };
    };
    calculateRetention: typeof calculateRetention;
    getRetentionLevel: typeof getRetentionLevel;
    calculateStrengthBoost: typeof calculateStrengthBoost;
    calculateDecayRate: typeof calculateDecayRate;
    projectRetention: typeof projectRetention;
    getDecayStatus: typeof getDecayStatus;
    getDecayStatusSQL: typeof getDecayStatusSQL;
    getNeedsReviewSQL: typeof getNeedsReviewSQL;
    getAtRiskSQL: typeof getAtRiskSQL;
    getArchiveSQL: typeof getArchiveSQL;
    getDeleteArchivedSQL: typeof getDeleteArchivedSQL;
    getHealthStatsSQL: typeof getHealthStatsSQL;
    getStrengthDistributionSQL: typeof getStrengthDistributionSQL;
    getBoostStrengthSQL: typeof getBoostStrengthSQL;
    DECAY_TOOLS: ({
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: {
                filter: {
                    type: string;
                    enum: string[];
                    default: string;
                    description: string;
                };
                limit: {
                    type: string;
                    default: number;
                    description: string;
                };
                project_id: {
                    type: string;
                    description: string;
                };
                action?: undefined;
                dry_run?: undefined;
                strength_threshold?: undefined;
                days_inactive?: undefined;
                id?: undefined;
                boost_amount?: undefined;
            };
            required?: undefined;
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: {
                project_id: {
                    type: string;
                    description: string;
                };
                filter?: undefined;
                limit?: undefined;
                action?: undefined;
                dry_run?: undefined;
                strength_threshold?: undefined;
                days_inactive?: undefined;
                id?: undefined;
                boost_amount?: undefined;
            };
            required?: undefined;
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: {
                action: {
                    type: string;
                    enum: string[];
                    default: string;
                    description: string;
                };
                dry_run: {
                    type: string;
                    default: boolean;
                    description: string;
                };
                strength_threshold: {
                    type: string;
                    default: number;
                    description: string;
                };
                days_inactive: {
                    type: string;
                    default: number;
                    description: string;
                };
                project_id: {
                    type: string;
                    description: string;
                };
                filter?: undefined;
                limit?: undefined;
                id?: undefined;
                boost_amount?: undefined;
            };
            required?: undefined;
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: {
                id: {
                    type: string;
                    description: string;
                };
                boost_amount: {
                    type: string;
                    default: number;
                    description: string;
                };
                filter?: undefined;
                limit?: undefined;
                project_id?: undefined;
                action?: undefined;
                dry_run?: undefined;
                strength_threshold?: undefined;
                days_inactive?: undefined;
            };
            required: string[];
        };
    })[];
    generateHealthRecommendations: typeof generateHealthRecommendations;
};
export default _default;
//# sourceMappingURL=decay.d.ts.map