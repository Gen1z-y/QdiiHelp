import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function legacyPath(input){
 if(!input)throw Error('旧文件维护工具必须显式指定工程目录以外的数据路径');
 const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),target=path.resolve(input);
 const relative=path.relative(root,target);
 if(relative===''||!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('禁止在工程目录内创建或维护运行数据，请指定外部路径');
 return target;
}
