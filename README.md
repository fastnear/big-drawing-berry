We're going to build a NEAR protocol app for an infinite drawing board inspired by the berryclub.io This repo is going to contain the following components:
- The smart contract. It'll be actually, pretty simple, so don't design much of it, we'll just make a simplest wasm with a single method name `draw` tha completely ignores the
  arguments. Again, we'll work on it later
- The frontend. Should be static vite+react app that can be hosted on the cloudflare pages. I want the design to resemble google maps. The background is the drawing board, there is
  a minimap on the bottom left, you can zoom in and zoom out (up to a limit). Your NEAR account/wallet is in the top-right in a cirlce. You have a color picker somewhere (and it can
  switch between moving mode and drawing mode). Every active component (non-board) has a drop shadow. When you move the map the URL reflects the current center point (starting from
  0,0). There is a grid visible at higher zoom levels. For mobile we want a read-only mode to work (scroll and see). The frontent will store the cache of the map in the local storage
  to efficiently retrive it.
- The indexer. It will read data from FastNear's neardata.xyz using `fastnear-neardata-fetcher` crate, filter function calls coming towards our contract, verify json and store them
  in Redis queue of draw events. The redis will have autosave feature. We'll use valkey instead of redis binary.
- The server. It will consume data from raw redis queue and update individual regions (e.g. 128x128) of the board. It'll also have a cache of recent board regions in memory for
  retrieval. It'll also have a websocket for clients to subscribe and GET api for UI to read individual board pieces. For each board we'll store the last update timestamp, so clients
  can efficiently request board updates, if they come back an hour later. Websockets will stream all drawing events, even outside the current view and frontends can just filter them
  out.

The rules are the drawing board is non-erasable. Once someone draw something, they claim that pixel and only they can change it within 1 hour of drawing the pixel. Once the hour
has passed the pixel becomes permanent. We'll use block_timestamp from the indexer to determine that.
