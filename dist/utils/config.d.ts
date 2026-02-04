/**
 * Just-Command Server Configuration
 *
 * Returns current server configuration and state.
 */
/**
 * Server configuration
 */
export interface ServerConfig {
    version: string;
    claudeDesktopMode: boolean;
    timeoutMs: number;
    responseLimitBytes: number;
    database: {
        path: string;
        backupDir: string;
        sizeBytes: number;
    };
    modules: {
        memory: boolean;
        filesystem: boolean;
        terminal: boolean;
        search: boolean;
    };
    toolCount: number;
    environment: {
        nodeVersion: string;
        platform: string;
        arch: string;
    };
}
/**
 * Get current server configuration
 */
export declare function getConfig(): ServerConfig;
//# sourceMappingURL=config.d.ts.map