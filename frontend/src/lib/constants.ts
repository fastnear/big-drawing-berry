export const CONTRACT_ID = "testberryfast.near";
export const REGION_SIZE = 128;
export const PIXEL_SIZE = 6; // 3 (RGB) + 3 (owner_id u24)
export const REGION_BLOB_SIZE = REGION_SIZE * REGION_SIZE * PIXEL_SIZE;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 40;
export const DEFAULT_ZOOM = 20;
export const GRID_ZOOM_THRESHOLD = 16; // Show grid lines at this zoom level and above

export const API_BASE = "http://localhost:3000";
export const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
    : "ws://localhost:3000/ws";
