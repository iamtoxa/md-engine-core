export type { EntitySnapInput } from "./protocol/codec"

export const pkg = "@iamtoxa/md-engine-net"
export type NetVersion = "0.0.0-dev"
export const version: NetVersion = "0.0.0-dev"

export { createRing, attachRing, writerEnqueue, readerDequeue, ringStats, RingFlags } from "./ipc/ring"
export { decodeEnvelope, encodePing, encodePong, encodeServerHello, encodeServerSnapshot, encodeServerInfo, encodeCommand } from "./protocol/codec"
export { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "./protocol/version.js"