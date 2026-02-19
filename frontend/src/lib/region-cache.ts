import { get, set } from "idb-keyval";

function cacheKey(rx: number, ry: number): string {
  return `region:${rx}:${ry}`;
}

function metaKey(rx: number, ry: number): string {
  return `region_meta:${rx}:${ry}`;
}

export async function getCachedRegion(
  rx: number,
  ry: number
): Promise<{ data: ArrayBuffer; lastUpdated: number } | null> {
  const data = await get<ArrayBuffer>(cacheKey(rx, ry));
  const lastUpdated = await get<number>(metaKey(rx, ry));
  if (data) {
    return { data, lastUpdated: lastUpdated ?? 0 };
  }
  return null;
}

export async function setCachedRegion(
  rx: number,
  ry: number,
  data: ArrayBuffer,
  lastUpdated: number
): Promise<void> {
  await set(cacheKey(rx, ry), data);
  await set(metaKey(rx, ry), lastUpdated);
}
