export function consoleManualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/]node_modules[\\/](three|@react-three|postprocessing)[\\/]/.test(id)) {
    return "vendor-3d";
  }
  if (
    /[\\/]node_modules[\\/](sigma|graphology|graphology-layout-forceatlas2)[\\/]/.test(
      id,
    )
  ) {
    return "vendor-graph";
  }
  if (
    /[\\/]node_modules[\\/](react|react-dom|@tanstack|lucide-react|clsx)[\\/]/.test(
      id,
    )
  ) {
    return "vendor-shell";
  }
  return undefined;
}
