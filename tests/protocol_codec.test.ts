import { decodeEnvelope, encodePing, encodePong } from "@iamtoxa/md-engine-net";
import type { Ping } from "../packages/net/dist/protocol/generated/mde";

test("encode/decode Ping", () => {
  const now = BigInt(Date.now());
  const buf = encodePing(1, now);
  const dec = decodeEnvelope(buf);
  expect(dec?.bodyType).toBe("Ping");
  expect(dec?.env.seq()).toBe(1);
  expect(
    dec && Number((dec.body as Ping).clientTimeMs().toString())
  ).toBeCloseTo(Number(now.toString()), -2);
});

test("encode/decode Pong", () => {
  const now = BigInt(Date.now());
  const buf = encodePong(2, now, now - BigInt(10));
  const dec = decodeEnvelope(buf);
  expect(dec?.bodyType).toBe("Pong");
  expect(dec?.env.seq()).toBe(2);
});
