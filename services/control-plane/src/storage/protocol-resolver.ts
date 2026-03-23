/**
 * ProtocolResolver — resolves canonical elementPaths to protocol-specific URIs.
 *
 * Reads NFS/SMB/S3 config from environment variables.
 * Returns null for unconfigured protocols.
 */

export type StorageProtocol = "nfs" | "smb" | "s3";

export interface ProtocolResolverConfig {
  nfsVip: string | null;
  smbServer: string | null;
  s3Bucket: string | null;
}

export function resolveConfig(): ProtocolResolverConfig {
  return {
    nfsVip: process.env.SPACEHARBOR_NFS_VIP ?? null,
    smbServer: process.env.SPACEHARBOR_SMB_SERVER ?? null,
    s3Bucket: process.env.SPACEHARBOR_S3_BUCKET ?? null,
  };
}

/**
 * Resolve an elementPath to a protocol-specific access URI.
 *
 * @param elementPath - Canonical POSIX path, e.g. `/vfx_830/seq_020/sh040/render/beauty_v003.0001.exr`
 * @param protocol - Target protocol: nfs, smb, or s3
 * @param config - Optional config override (defaults to env vars)
 * @returns Protocol URI string, or null if protocol is not configured
 */
export function resolveAccessUri(
  elementPath: string,
  protocol: StorageProtocol,
  config?: ProtocolResolverConfig,
): string | null {
  const cfg = config ?? resolveConfig();
  const cleanPath = elementPath.replace(/^\/+/, "");

  switch (protocol) {
    case "nfs": {
      if (!cfg.nfsVip) return null;
      return `${cfg.nfsVip}:/${cleanPath}`;
    }
    case "smb": {
      if (!cfg.smbServer) return null;
      const windowsPath = cleanPath.replace(/\//g, "\\");
      return `\\\\${cfg.smbServer}\\${windowsPath}`;
    }
    case "s3": {
      if (!cfg.s3Bucket) return null;
      return `s3://${cfg.s3Bucket}/${cleanPath}`;
    }
    default:
      return null;
  }
}

/**
 * Resolve all configured protocol URIs for an elementPath.
 * Returns only protocols that have config available.
 */
export function resolveAllProtocols(
  elementPath: string,
  config?: ProtocolResolverConfig,
): Record<StorageProtocol, string | null> {
  const cfg = config ?? resolveConfig();
  return {
    nfs: resolveAccessUri(elementPath, "nfs", cfg),
    smb: resolveAccessUri(elementPath, "smb", cfg),
    s3: resolveAccessUri(elementPath, "s3", cfg),
  };
}
