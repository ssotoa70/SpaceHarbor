import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAccessUri,
  resolveAllProtocols,
  type ProtocolResolverConfig,
} from "../src/storage/protocol-resolver.js";

const fullConfig: ProtocolResolverConfig = {
  nfsVip: "10.0.1.100",
  smbServer: "vast-smb.studio.local",
  s3Bucket: "vfx-assets",
};

const emptyConfig: ProtocolResolverConfig = {
  nfsVip: null,
  smbServer: null,
  s3Bucket: null,
};

const elementPath = "/vfx_830/seq_020/sh040/render/beauty_v003.0001.exr";

test("resolveAccessUri — NFS protocol", () => {
  const uri = resolveAccessUri(elementPath, "nfs", fullConfig);
  assert.equal(uri, "10.0.1.100:/vfx_830/seq_020/sh040/render/beauty_v003.0001.exr");
});

test("resolveAccessUri — SMB protocol", () => {
  const uri = resolveAccessUri(elementPath, "smb", fullConfig);
  assert.equal(uri, "\\\\vast-smb.studio.local\\vfx_830\\seq_020\\sh040\\render\\beauty_v003.0001.exr");
});

test("resolveAccessUri — S3 protocol", () => {
  const uri = resolveAccessUri(elementPath, "s3", fullConfig);
  assert.equal(uri, "s3://vfx-assets/vfx_830/seq_020/sh040/render/beauty_v003.0001.exr");
});

test("resolveAccessUri — unconfigured protocol returns null", () => {
  assert.equal(resolveAccessUri(elementPath, "nfs", emptyConfig), null);
  assert.equal(resolveAccessUri(elementPath, "smb", emptyConfig), null);
  assert.equal(resolveAccessUri(elementPath, "s3", emptyConfig), null);
});

test("resolveAllProtocols — returns all configured URIs", () => {
  const result = resolveAllProtocols(elementPath, fullConfig);
  assert.ok(result.nfs);
  assert.ok(result.smb);
  assert.ok(result.s3);
});

test("resolveAllProtocols — returns null for unconfigured", () => {
  const result = resolveAllProtocols(elementPath, emptyConfig);
  assert.equal(result.nfs, null);
  assert.equal(result.smb, null);
  assert.equal(result.s3, null);
});
