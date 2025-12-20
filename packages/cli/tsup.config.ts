import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/bin.ts"],
  outDir: "dist",
  format: ["esm"],
  clean: true,
  treeshake: "smallest",
  noExternal: [/.*/],
  external: ["@parcel/watcher"],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`
  }
})
