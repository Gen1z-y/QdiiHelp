// Request-local inputs: repeated stages share work without extending freshness.
export class RefreshInputs {
 constructor(){this.navs=new Map();this.bonds=new Map();this.profiles=new Map();}
 profile(code,load){return this.once(this.profiles,code,load);}
 nav(code,load){return this.once(this.navs,code,load);}
 bond(code,date,load){return this.once(this.bonds,code+':'+date,load);}
 once(cache,key,load){if(!cache.has(key))cache.set(key,Promise.resolve().then(load));return cache.get(key);}
}
