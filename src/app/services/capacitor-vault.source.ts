import { Injectable, inject } from "@angular/core";

import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";
import { ConfigService } from "./config.service";
import { VaultService } from "./vault.service";
import type { NoteBatch, VaultSource } from "./vault-source";

/**
 * The vault as a folder on the device, read through Capacitor's Filesystem.
 *
 * A thin adapter over `VaultService` and `ConfigService` rather than a rewrite of
 * them: both are covered by tests, and the port exists to let a second source
 * alongside them, not to churn the one that already works.
 */
@Injectable({ providedIn: "root" })
export class CapacitorVaultSource implements VaultSource {
  private readonly vault = inject(VaultService);
  private readonly config = inject(ConfigService);
  private path = "";

  readonly label = "Device folder";

  isAvailable(): boolean {
    // On the web this is backed by IndexedDB rather than the disk, which is only
    // useful for the sample vault — but it does still work, so it stays offered.
    return true;
  }

  canWrite(): boolean {
    return true;
  }

  open(location: string): Promise<void> {
    this.path = location;
    return Promise.resolve();
  }

  readNotes(onBatch?: NoteBatch): Promise<ParsedNote[]> {
    return this.vault.readNotes(this.path, onBatch);
  }

  writeReviewState(notePath: string, front: string, review: ReviewState): Promise<void> {
    return this.vault.writeReviewState(this.path, notePath, front, review);
  }

  editNote(notePath: string, transform: (md: string) => string): Promise<void> {
    return this.vault.editNote(this.path, notePath, transform);
  }

  /** The vault folder's own name — what Obsidian lists it under. */
  vaultName(): string {
    return this.path.split("/").filter(Boolean).pop() ?? "";
  }

  readConfig(): Promise<GneissConfig> {
    return this.config.read(this.path);
  }

  writeConfig(config: GneissConfig): Promise<void> {
    return this.config.write(this.path, config);
  }
}
