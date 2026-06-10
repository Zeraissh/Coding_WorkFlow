export declare class SnapshotManager {
    private snapshotDir;
    private currentSnapshotId;
    private cwd;
    constructor(cwd?: string);
    /**
     * Take a snapshot of the current src and tests directories
     */
    createSnapshot(): string;
    /**
     * Rollback to the current snapshot
     */
    rollback(): void;
    /**
     * Remove the snapshot (auto-prune on success)
     */
    prune(): void;
}
//# sourceMappingURL=snapshotManager.d.ts.map