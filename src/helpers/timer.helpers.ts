export const getEventLoopLag = async (): Promise<number> => {
  const start = performance.now();
  await new Promise(resolve => setImmediate(resolve));
  return performance.now() - start;
};
