import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/server.ts', 'src/react.tsx'], format: ['esm'], dts: true, clean: true, sourcemap: true, external: ['next', 'react', 'react/jsx-runtime', 'server-only'] });
