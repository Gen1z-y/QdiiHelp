// Test-only upstream fault injection; never imported by normal application entrypoints.
import readline from 'node:readline';
await import('./preview-fixture.mjs');
const original=globalThis.fetch;let failing=true;
readline.createInterface({input:process.stdin}).on('line',line=>{try{if(JSON.parse(line).command==='test-recover')failing=false;}catch{}});
globalThis.fetch=async input=>{
 const url=String(input);await new Promise(r=>setTimeout(r,70));
 if(failing&&url.includes('lsjz')&&url.includes('fundCode=123456'))throw Error('测试上游暂时不可用');
 return original(input);
};
