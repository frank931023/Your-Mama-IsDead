import type { IStorageProvider } from "./IStorageProvider.js";
import { PinataProvider } from "./pinata.js";
import { Web3StorageProvider } from "./web3storage.js";
import { LocalProvider } from "./local.js";
import { IrysProvider } from "./irys.js";

export type StorageDriver = "pinata" | "web3storage" | "local" | "irys";

/**
 * Factory: returns the configured storage provider.
 *
 * Resolution order:
 *   1. explicit `driver` arg
 *   2. `STORAGE_DRIVER` env var
 *   3. fallback to `pinata` (prototype default)
 */
export function getProvider(driver?: string): IStorageProvider {
  const d = (driver ?? process.env.STORAGE_DRIVER ?? "pinata").toLowerCase();
  switch (d) {
    case "pinata":
      return new PinataProvider();
    case "web3storage":
    case "web3.storage":
    case "w3s":
      return new Web3StorageProvider();
    case "local":
    case "fs":
      return new LocalProvider();
    case "irys":
    case "arweave":
      return new IrysProvider();
    default:
      throw new Error(
        `getProvider: unknown driver "${d}" (expected one of: pinata, web3storage, local, irys)`,
      );
  }
}

export type {
  IStorageProvider,
  PutResult,
  Tag,
} from "./IStorageProvider.js";
export { PinataProvider } from "./pinata.js";
export { Web3StorageProvider } from "./web3storage.js";
export { LocalProvider } from "./local.js";
export { IrysProvider } from "./irys.js";
