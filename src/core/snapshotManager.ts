import * as fs from 'fs';
import * as path from 'path';

export class SnapshotManager {
  private snapshotDir: string;
  private currentSnapshotId: string | null = null;
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.snapshotDir = path.join(cwd, '.workflow', 'snapshots');
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  /**
   * Take a snapshot of the current src and tests directories
   */
  public createSnapshot(): string {
    this.currentSnapshotId = `snap_${Date.now()}`;
    const targetDir = path.join(this.snapshotDir, this.currentSnapshotId);
    fs.mkdirSync(targetDir, { recursive: true });

    const dirsToBackup = ['src', 'tests'];
    for (const dir of dirsToBackup) {
      const srcPath = path.join(this.cwd, dir);
      const destPath = path.join(targetDir, dir);
      if (fs.existsSync(srcPath)) {
        fs.cpSync(srcPath, destPath, { recursive: true });
      }
    }
    return this.currentSnapshotId;
  }

  /**
   * Rollback to the current snapshot
   */
  public rollback(): void {
    if (!this.currentSnapshotId) return;
    const targetDir = path.join(this.snapshotDir, this.currentSnapshotId);
    if (!fs.existsSync(targetDir)) return;

    const dirsToBackup = ['src', 'tests'];
    for (const dir of dirsToBackup) {
      const destPath = path.join(this.cwd, dir);
      const srcPath = path.join(targetDir, dir);
      if (fs.existsSync(srcPath)) {
        // Remove existing dirs and replace with snapshot
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        fs.cpSync(srcPath, destPath, { recursive: true });
      }
    }
  }

  /**
   * Remove the snapshot (auto-prune on success)
   */
  public prune(): void {
    if (!this.currentSnapshotId) return;
    const targetDir = path.join(this.snapshotDir, this.currentSnapshotId);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    this.currentSnapshotId = null;
  }
}
