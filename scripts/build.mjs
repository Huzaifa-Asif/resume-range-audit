import { copyFileSync, writeFileSync } from 'node:fs';

copyFileSync(new URL('../dist/index.d.ts', import.meta.url), new URL('../dist/index.d.mts', import.meta.url));
writeFileSync(new URL('../dist/index.mjs', import.meta.url), "import api from './index.js';\nexport const { auditResumeResponse } = api;\n");
