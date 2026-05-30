import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['source/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['source/**/*.ts'],
            exclude: ['source/**/*.test.ts', 'source/types/**', 'source/index.ts']
        }
    }
});
