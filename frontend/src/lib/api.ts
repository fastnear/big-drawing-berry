import { API_BASE } from "./constants";
import type { RegionCoord, RegionMeta } from "./types";

export async function fetchRegion(rx: number, ry: number): Promise<{
  data: ArrayBuffer;
  lastUpdated: number;
}> {
  const res = await fetch(`${API_BASE}/api/region/${rx}/${ry}`);
  const data = await res.arrayBuffer();
  const lastUpdated = parseInt(res.headers.get("x-last-updated") || "0", 10);
  return { data, lastUpdated };
}

export async function fetchRegionMeta(rx: number, ry: number): Promise<RegionMeta> {
  const res = await fetch(`${API_BASE}/api/region/${rx}/${ry}/meta`);
  return res.json();
}

export async function fetchRegionsBatch(
  coords: Array<[number, number]>
): Promise<RegionMeta[]> {
  const param = coords.map(([rx, ry]) => `${rx},${ry}`).join(",");
  const res = await fetch(`${API_BASE}/api/regions?coords=${param}`);
  return res.json();
}

export async function fetchOpenRegions(): Promise<RegionCoord[]> {
  const res = await fetch(`${API_BASE}/api/open-regions`);
  return res.json();
}

/** Fetch fresh pixel timestamps (< 1hr old) for a region. Returns [[lx, ly, ts_ms], ...] */
export async function fetchRegionTimestamps(
  rx: number,
  ry: number
): Promise<Array<[number, number, number]>> {
  const res = await fetch(`${API_BASE}/api/region/${rx}/${ry}/timestamps`);
  return res.json();
}
