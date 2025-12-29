import { defineConfig } from "tsup"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

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
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version)
  }
})
