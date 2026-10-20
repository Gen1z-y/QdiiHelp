import fs from 'node:fs';
export function databaseConfig(){
 const file=process.env.QDII_DATABASE_CONFIG??new URL('../config/database.local.json',import.meta.url);
 if(!fs.existsSync(file))throw Error('缺少数据库连接配置，请将 config/database.example.json 复制为 config/database.local.json 并配置连接');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
