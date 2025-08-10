import { attachRing, createRing, readerDequeue, writerEnqueue } from "@iamtoxa/md-engine-net"


test("ring basic enqueue/dequeue", () => {
const { sab } = createRing(4096)
const ring = attachRing(sab)


const payload = new Uint8Array([1, 2, 3, 4, 5])
const ok = writerEnqueue(ring, 42, 0, payload)
expect(ok).toBe(true)


const msg = readerDequeue(ring)
expect(msg).not.toBeNull()
expect(msg!.type).toBe(42)
expect(Array.from(msg!.payload)).toEqual([1, 2, 3, 4, 5])
})