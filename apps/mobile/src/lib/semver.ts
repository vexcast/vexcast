/** Minimal semver helpers (major.minor.patch with optional "v" prefix and pre-release). */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

export function parseVersion(input: string | null | undefined): SemVer | null {
  if (!input) return null;
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(input);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
    pre: m[4] ?? null,
  };
}

/** Returns <0 if a<b, 0 if equal, >0 if a>b. Unparseable versions sort lowest. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return va ? 1 : vb ? -1 : 0;
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  // A version without pre-release is newer than one with it.
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

/** True when both versions parse and differ in major or minor. */
export function majorMinorDiffers(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return false;
  return va.major !== vb.major || va.minor !== vb.minor;
}
