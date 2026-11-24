import { strToU8, zipSync } from "fflate";
import manifestTemplate from "../../../../../connector/manifest.json";
import serverSource from "../../../../../connector/server/index.js?raw";

// Builds thinkcards.mcpb (an MCP bundle for Claude Desktop) from the files in
// /connector, with this instance's endpoint as the default server URL. The
// token is never in the file: Claude Desktop asks for it on install.

export const BUNDLE_FILE = "thinkcards.mcpb";

export const buildManifest = (connectorUrl: string, withIcon: boolean) => {
  const manifest = structuredClone(manifestTemplate) as typeof manifestTemplate & {
    icon?: string;
  };
  manifest.user_config.server_url.default = connectorUrl;
  if (withIcon) manifest.icon = "icon.png";
  return manifest;
};

export const buildBundle = (connectorUrl: string, icon?: Uint8Array): Uint8Array =>
  zipSync({
    "manifest.json": strToU8(JSON.stringify(buildManifest(connectorUrl, !!icon), null, 2)),
    server: { "index.js": strToU8(serverSource) },
    ...(icon ? { "icon.png": icon } : {}),
  });

const fetchIcon = async (): Promise<Uint8Array | undefined> => {
  try {
    const res = await fetch("/images/logo.png");
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
};

export const saveFile = (bytes: Uint8Array, name: string, type: string): void => {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadBundle = async (connectorUrl: string): Promise<void> => {
  saveFile(buildBundle(connectorUrl, await fetchIcon()), BUNDLE_FILE, "application/zip");
};
