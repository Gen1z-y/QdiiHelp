// Isolated UI preview; no personal state is read or written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PORT='8792';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-markets-'));
process.env.QDII_DATA_FILE=path.join(dir,'state.json');
fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:[],records:{},lastView:{}}));
await import('../server.mjs');
