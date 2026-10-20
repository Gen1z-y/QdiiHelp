import {databaseConfig} from '../lib/database-config.mjs';
import {PostgresStore} from '../lib/postgres-store.mjs';
import {PostgresBackups} from '../lib/postgres-backups.mjs';
const store=await PostgresStore.open('postgres:qdiihelp',databaseConfig());
try{const backups=await PostgresBackups.open(store);console.log(JSON.stringify(await backups.create(),null,2));}finally{await store.close();}
