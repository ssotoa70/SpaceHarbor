export function withPrefix(prefix: string, path: string): string {
  if (!prefix) {
    return path;
  }

  return `${prefix}${path}`;
}
