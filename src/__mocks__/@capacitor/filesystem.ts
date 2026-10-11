export const Directory = {
  Cache: "CACHE",
} as const;

export const Encoding = {
  UTF8: "utf8",
} as const;

export const Filesystem = {
  writeFile: async ({
    path,
  }: {
    path: string;
    data: string;
    directory: string;
    encoding: string;
  }): Promise<{ uri: string }> => ({ uri: `file://${path}` }),
};
