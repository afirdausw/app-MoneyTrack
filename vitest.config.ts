import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
      '@server': path.resolve(__dirname, 'src/server'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // File struk dari test ditulis ke folder sementara, bukan ke uploads/ asli.
    env: { UPLOAD_DIR: './.tmp/test-uploads' },
  },
});
