import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [
    vinext({ nextConfig: { output: 'export' } }),
    ...(command === 'build'
      ? [cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } })]
      : []),
  ],
}));
