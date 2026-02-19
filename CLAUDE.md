# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

### Backend (Rust workspace)
```bash
cd backend && cargo build          # Build all: common, indexer, server
cd backend && cargo build -p server    # Build only the server
cd backend && cargo build -p indexer   # Build only the indexer
```

### Contract (NEAR wasm)
```bash
cd contract && cargo build --target wasm32-unknown-unknown --release
# Or use: cd contract && ./build.sh
```

### Frontend (Vite + React + TypeScript)
```bash
cd frontend && yarn install
cd frontend && yarn dev            # Dev server with proxy to backend
cd frontend && yarn build          # Production build (runs tsc + vite)
```
Note: `npm` is broken on this machine. Use `yarn` for package management.

### Infrastructure
```bash
docker compose up                  # Start Valkey (Redis-compatible) on port 6379
```

### Type checking
```bash
cd frontend && ./node_modules/.bin/tsc --noEmit
```

## Architecture

Infinite pixel drawing board on NEAR Protocol. Four components connected via Valkey (Redis-compatible):

```
NEAR blockchain → Indexer → Valkey queue → Server → WebSocket → Frontend
                                             ↕
                                      Valkey (regions)
```

**Contract** (`contract/`): Minimal — single `draw()` method with empty body. Exists only so transactions can be sent; the indexer reads args directly from chain data.

**Indexer** (`backend/indexer/`): Streams blocks via `fastnear-neardata-fetcher`, filters receipts to `berryfast.near` with method `draw`, validates pixel JSON, LPUSHes `DrawEvent` to Valkey `draw_queue`. Imports types from `fastnear_primitives` (not re-exported by the fetcher crate).

**Server** (`backend/server/`): Axum HTTP/WS server. Consumer goroutine RPOPLPUSHes from `draw_queue` to `processing_queue`, applies events to board (ownership rules), broadcasts via `tokio::sync::broadcast`, LREMs after success. Serves region blobs over REST and streams draw events over WebSocket.

**Frontend** (`frontend/`): Vite/React app. Full-viewport canvas with Google Maps-style pan/zoom. NEAR Wallet Selector for signing `draw` transactions. IndexedDB cache for region blobs (too large for localStorage). WebSocket for live updates.

## Data Model

### Pixel binary format (6 bytes, little-endian)
| Offset | Size | Field |
|--------|------|-------|
| 0-2 | 3 | RGB color |
| 3-5 | 3 | owner_id (u24 LE, 0 = undrawn) |

A pixel with `owner_id == 0` is undrawn (all-zeros = black background, no initialization needed).

### Pixel timestamps
Stored separately in per-region Valkey sorted sets (`pixel_ts:{rx}:{ry}`):
- **member**: `"{lx},{ly}"` (local pixel coordinate string)
- **score**: block_timestamp (nanoseconds, as f64)
Old entries (>1h) are trimmed via `ZREMRANGEBYSCORE` after each region update.

### Regions
128×128 pixels = 98,304 bytes per region blob. Region coords use `div_euclid`/`rem_euclid` for correct negative coordinate handling. Pixel offset: `(ly * 128 + lx) * 6`.

### Ownership rules (enforced in `board.rs`)
1. Undrawn pixel (owner_id=0): anyone can draw
2. Within 1 hour of last draw (via ZSCORE): only the owner can change it
3. After 1 hour: pixel is permanent, nobody can change it
4. No timestamp found for an owned pixel: treated as permanent (pre-migration data)

Ownership window uses NEAR block timestamps (nanoseconds), not wall clock time.

### Owner IDs
Each NEAR account gets a u32 index assigned on first draw (starting at 1; 0 is reserved as "undrawn" sentinel). Bidirectional lookup via `account_to_id` / `id_to_account` Valkey hashes. Assumes single consumer instance (no locking for ID assignment).

## Key Valkey Keys
- `draw_queue` / `processing_queue` — reliable queue pattern (RPOPLPUSH + LREM)
- `region:{rx}:{ry}` — binary region blob
- `region_meta:{rx}:{ry}` — hash with `last_updated` timestamp
- `pixel_ts:{rx}:{ry}` — sorted set of pixel timestamps (score=block_timestamp_ns, member="{lx},{ly}")
- `draw_events` — sorted set for WS catch-up (trimmed to 2h)
- `last_processed_block` — indexer resume point
- `account_to_id` / `id_to_account` — owner ID mappings

## Shared Constants
`REGION_SIZE=128` and `PIXEL_SIZE=6` are defined in both `backend/common/src/region.rs` and `frontend/src/lib/constants.ts`. These must be kept in sync manually.

## Environment Variables
- `CONTRACT_ID` — NEAR contract account (default: `berryfast.near`), used by indexer
- `VALKEY_URL` — Valkey connection (default: `redis://127.0.0.1:6379`), used by both indexer and server
- `LISTEN_ADDR` — Server listen address (default: `0.0.0.0:3000`)
