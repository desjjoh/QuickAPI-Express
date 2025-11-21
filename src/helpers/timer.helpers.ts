export const getEventLoopLag = async (): Promise<number> => {
  const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, 0));
  return performance.now() - start;
};
