import { defineConfig } from "vite";
  import viteReact from "@vitejs/plugin-react";
  import viteTsConfigPaths from "vite-tsconfig-paths";
  import tailwindcss from "@tailwindcss/vite";
  import path from "path";

  export default defineConfig({
    server: {
      port: Number(process.env.PORT) || 5173,
      host: true,
      allowedHosts: "all",
    },
    resolve: {
      alias: {
        "@workspace/api-client-react": path.resolve(
          import.meta.dirname,
          "src/_workspace/api-client-react/src/index.ts",
        ),
      },
    },
    plugins: [
      viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
      tailwindcss(),
      viteReact(),
    ],
    build: {
      outDir: "dist",
    },
  });
  