export const CONTRACT_ID = "berryfast.near";
export const REGION_SIZE = 128;
export const PIXEL_SIZE = 6; // 3 (RGB) + 3 (owner_id u24)
export const REGION_BLOB_SIZE = REGION_SIZE * REGION_SIZE * PIXEL_SIZE;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 40;
export const GRID_ZOOM_THRESHOLD = 8; // Show grid lines at this zoom level and above

export const API_BASE = "";
export const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
    : "ws://localhost:3000/ws";
