import { Injectable } from "@angular/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { DEFAULT_CONFIG, formatConfig, parseConfig } from "../../vault";
import type { GneissConfig } from "../../vault";

/** Inside the vault, so it syncs with the notes. A dotfolder, so it is not a note. */
const CONFIG_PATH = ".gneiss/config.md";

/**
 * Reads and writes Gneiss's own settings inside the vault.
 *
 * Note this is the one file Gneiss owns — unlike the notes, which it only reads.
 */
@Injectable({ providedIn: "root" })
export class ConfigService {
  /** Falls back to defaults when the file is absent, as on first launch. */
  async read(vaultPath: string): Promise<GneissConfig> {
    try {
      const { data } = await Filesystem.readFile({
        path: pathWithin(vaultPath),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return parseConfig(typeof data === "string" ? data : await data.text());
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async write(vaultPath: string, config: GneissConfig): Promise<void> {
    await Filesystem.writeFile({
      path: pathWithin(vaultPath),
      data: formatConfig(config),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }
}

function pathWithin(vaultPath: string): string {
  return vaultPath ? `${vaultPath}/${CONFIG_PATH}` : CONFIG_PATH;
}
