/**
 * Self-describing manifest for an off-line training artifact bundle.
 * Produced by training/pipelines/06_package_artifact.py.
 * Published to IPFS/Arweave; URI written back to NFT via setArtifactURI().
 */

export interface ArtifactManifest {
  tokenId: number;
  version: string;            // "v1", "v2", ...
  createdAt: string;          // ISO datetime
  models: {
    lora?: {
      uri: string;
      base: string;           // "sdxl-1.0" / "flux-dev" / ...
      rank: number;
      steps: number;
    };
    voice?: {
      uri: string;
      backend: "gpt-sovits" | "elevenlabs";
      sampleRate?: number;
    };
    rag?: {
      uri: string;
      embed: string;          // model id
      chunks: number;
      chunkSize: number;
    };
  };
  checksum: string;           // sha256 of bundled artifact
}

export type JobStatus = "QUEUED" | "RUNNING" | "UPLOADED" | "DONE" | "FAILED";
