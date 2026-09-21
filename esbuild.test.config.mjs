import esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['journalCleanup.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile: '.test-dist/journalCleanup.js',
    logLevel: 'silent',
});
