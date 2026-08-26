import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_ROOT || path.join(process.cwd(), "storage"));

function resolveKey(key: string) {
  const target = path.resolve(storageRoot, key);
  const relative = path.relative(storageRoot, target);
  if (!key || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid private storage key.");
  }
  return target;
}

export async function writePrivateFile(key: string, data: Buffer) {
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = target + "." + process.pid + ".tmp";
  await writeFile(temp, data);
  await rename(temp, target);
  return { key, size: data.byteLength };
}

export async function readPrivateFile(key: string) {
  return readFile(resolveKey(key));
}

export async function privateFileExists(key: string) {
  try {
    return (await stat(resolveKey(key))).isFile();
  } catch {
    return false;
  }
}
