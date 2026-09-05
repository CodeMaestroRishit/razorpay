// Populated by the express.json() verify hook in api/server.ts, before
// the body is parsed — see webhooks/receiver.ts for why signature
// verification needs the raw bytes rather than a re-serialized body.
declare namespace Express {
  interface Request {
    rawBody?: Buffer;
  }
}
