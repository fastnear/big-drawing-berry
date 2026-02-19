export interface Camera {
  x: number; // center x in world coordinates
  y: number; // center y in world coordinates
  zoom: number;
}

export interface DrawPixel {
  x: number;
  y: number;
  color: string; // hex "FF5733"
}

export interface DrawEventWS {
  type: "draw";
  signer: string;
  block_timestamp: number;
  pixels: DrawPixel[];
}

export interface RegionMeta {
  rx: number;
  ry: number;
  last_updated: number;
}

export interface RegionCoord {
  rx: number;
  ry: number;
}
