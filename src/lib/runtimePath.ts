import path from "path";

/**
 * Path under process.cwd() that Turbopack must not NFT-trace.
 * Chrome profiles / lock files live at the repo root and must stay runtime-only.
 */
export function runtimePath(...segments: string[]): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), ...segments);
}
