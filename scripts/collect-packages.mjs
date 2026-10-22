import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(await readFile(join(root,'src-tauri/tauri.conf.json'),'utf8'));
const version=config.version;
const out=join(root,'artifacts');
await mkdir(out,{recursive:true});
const release=join(root,'src-tauri/target/release');
async function collect(kind,extension) {
  const folder=join(release,'bundle',kind);
  const names=(await readdir(folder)).filter(n=>n.endsWith(extension));
  if(!names.length) throw new Error(`Missing ${kind} package`);
  for(const name of names) await copyFile(join(folder,name),join(out,name));
}
if(process.platform==='win32') {
  await collect('msi','.msi');
  const portable=join(root,'dist',`Aureon-${version}-portable`);
  await mkdir(portable,{recursive:true});
  await copyFile(join(release,'Aureon.exe'),join(portable,'Aureon.exe'));
  await copyFile(join(root,'LICENSE'),join(portable,'LICENSE'));
  await writeFile(join(portable,'README.txt'),
    'Aureon — Windows x64, запуск без установки.\r\nРаспакуйте ZIP и запустите Aureon.exe.\r\nНужен WebView2 Runtime. Если он не установлен, используйте MSI.\r\nНастройки хранятся в профиле Windows, не рядом с EXE.\r\n');
  // Windows' libarchive tar writes ZIP without invoking a shell.
  execFileSync('tar.exe',['-a','-c','-f',join(out,`Aureon_${version}_windows-x64_portable.zip`),'-C',portable,'.'],{stdio:'inherit'});
} else if(process.platform==='linux') {
  await collect('deb','.deb');
  await collect('appimage','.AppImage');
} else throw new Error('Only Windows and Linux packages are supported here');
const names=(await readdir(out)).filter(n=>/\.(msi|zip|deb|AppImage)$/.test(n)).sort();
const checksums=await Promise.all(names.map(async name=>`${createHash('sha256').update(await readFile(join(out,name))).digest('hex')}  ${name}`));
await writeFile(join(out,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
console.log(names.join('\n'));
