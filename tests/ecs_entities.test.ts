import { World } from "@iamtoxa/md-engine-ecs-core";

test("create/destroy entity deferred", () => {
  const w = new World({ maxEntities: 1000 });
  const e = w.createEntity();
  expect(w.aliveMask()[e.id]).toBe(1);
  w.destroyEntityDeferred(e);
  expect(w.aliveMask()[e.id]).toBe(1);
  w.tick("post", 0);
  expect(w.aliveMask()[e.id]).toBe(0);
});
