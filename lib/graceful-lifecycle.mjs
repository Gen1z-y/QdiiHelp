// Stop accepting new work, drain existing operations, then persist and close.
export function gracefulLifecycle({begin, pending, close}) {
 let task;
 return () => task ??= (async () => {
  begin();
  for (;;) {
   const work=pending().filter(Boolean);
   if (!work.length) break;
   await Promise.allSettled(work);
  }
  await close();
 })();
}
