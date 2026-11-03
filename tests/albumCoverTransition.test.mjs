import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (await readFile(new URL('../src/lib/albumCoverTransition.ts', import.meta.url), 'utf8'))
  .replace("import { shallowRef } from 'vue';", 'const shallowRef = value => ({value});')
  .replace("import { useUiStore } from '@/stores/ui';", 'const useUiStore = () => globalThis.coverMotionFixture.ui;');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
let run = 0;

async function fixture(t) {
  const keys = ['window','document','HTMLImageElement','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','coverMotionFixture'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  const frames = new Map(); let frameId = 0;
  const ui = {settings:{animations:true}};
  const cards = [];
  class Cover {
    constructor(left=300,top=190,width=150,height=150) {
      this.rect={left,top,width,height,right:left+width,bottom:top+height};
      this.attrs=new Set();this.isConnected=true;this.dataset={};this.scroll=null;this.shelf=null;
      this.img=new Image();
    }
    getBoundingClientRect(){return this.rect;}
    querySelector(){return this.img;}
    closest(selector){return selector==='.q-scrollarea__container'?this.scroll:selector==='.home-shelf-viewport'?this.shelf:null;}
    hasAttribute(name){return this.attrs.has(name);}
    setAttribute(name){this.attrs.add(name);}
    removeAttribute(name){this.attrs.delete(name);}
  }
  class Image {
    complete=true;naturalWidth=512;src='https://covers.invalid/album.jpg';currentSrc=this.src;
  }
  Object.assign(globalThis, {
    coverMotionFixture:{ui}, window:{innerWidth:1280,innerHeight:720,matchMedia:()=>({matches:false})},
    document:{hidden:false,querySelectorAll:()=>cards}, HTMLImageElement:Image,
    getComputedStyle:()=>({borderTopLeftRadius:'10px'}),
    requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},
    cancelAnimationFrame:id=>frames.delete(id),
  });
  const motion=await import('data:text/javascript;base64,'+Buffer.from(compiled+'\n//run'+(++run)).toString('base64'));
  t.after(()=>{motion.cancelAlbumCoverTransition();for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  return {motion,ui,Cover,cards,frames,flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}

test('fast navigation restores old covers and stale completion cannot cancel a newer flight',async t=>{
  const {motion,Cover}=await fixture(t),first=new Cover(),second=new Cover(480);
  assert.equal(motion.beginAlbumCoverTransition('first',first,'album'),true);
  const old=motion.albumCoverTransfer.value.token;
  assert.ok(first.attrs.has('data-cover-flight-hidden'));
  motion.beginAlbumCoverTransition('second',second,'album');
  const current=motion.albumCoverTransfer.value.token;
  assert.ok(!first.attrs.has('data-cover-flight-hidden'));
  motion.cancelAlbumCoverTransition(old);
  assert.equal(motion.albumCoverTransfer.value.token,current);
  motion.guardAlbumCoverRoute('/liked');
  assert.equal(motion.albumCoverTransfer.value,null);
  assert.ok(!second.attrs.has('data-cover-flight-hidden'));
});

test('missing images and disabled animations leave normal DOM covers visible',async t=>{
  const {motion,Cover,ui}=await fixture(t),cover=new Cover();
  cover.img.naturalWidth=0;
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),false);
  cover.img.naturalWidth=512;ui.settings.animations=false;
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),false);
  assert.equal(cover.attrs.size,0);
  assert.equal(motion.albumCoverTransfer.value,null);
});

test('opening an album without a source cover discards a previous visit origin',async t=>{
  const {motion,Cover}=await fixture(t),oldCard=new Cover(),hero=new Cover(330,110,240,240);
  oldCard.scroll={scrollTop:230,scrollLeft:0};
  assert.equal(motion.beginAlbumCoverTransition('a',oldCard,'album'),true);
  motion.cancelAlbumCoverTransition();
  assert.equal(motion.beginAlbumCoverTransition('a',null,'album'),false);
  assert.equal(motion.beginAlbumCoverTransition('a',hero,'home'),false);
  assert.equal(motion.albumCoverTransfer.value,null);
  assert.equal(oldCard.attrs.size,0);assert.equal(hero.attrs.size,0);
});

test('failed or slow album loading releases the floating image and its source',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {motion,Cover}=await fixture(t),cover=new Cover();
  motion.beginAlbumCoverTransition('a',cover,'album');
  t.mock.timers.tick(1801);
  assert.equal(motion.albumCoverTransfer.value,null);
  assert.equal(cover.attrs.size,0);
});

test('destination waits for its loaded image and then returns ownership to the real cover',async t=>{
  const {motion,Cover,flush}=await fixture(t),source=new Cover(),target=new Cover(330,110,240,240);
  motion.beginAlbumCoverTransition('a',source,'album');source.isConnected=false;
  target.img.complete=false;
  motion.finishAlbumCoverTransition('a',target);
  assert.equal(motion.albumCoverTransfer.value.to,null);
  assert.equal(target.attrs.size,0);
  target.img.complete=true;flush();
  const flight=motion.albumCoverTransfer.value;
  assert.equal(flight.to.width,240);
  assert.ok(target.attrs.has('data-cover-flight-hidden'));
  motion.cancelAlbumCoverTransition(flight.token);
  assert.equal(source.attrs.size,0);assert.equal(target.attrs.size,0);
});

test('returning Home restores the original scroll and user scrolling cancels stale coordinates',async t=>{
  const {motion,Cover,cards}=await fixture(t),source=new Cover(),hero=new Cover(330,110,240,240);
  source.scroll={scrollTop:230,scrollLeft:0};
  motion.beginAlbumCoverTransition('a',source,'album');motion.cancelAlbumCoverTransition();
  motion.beginAlbumCoverTransition('a',hero,'home');hero.isConnected=false;
  const returned=new Cover();returned.dataset.homeAlbumCover='a';returned.scroll={scrollTop:0,scrollLeft:0};cards.push(returned);
  motion.arriveHomeAlbumCoverTransition();
  assert.equal(returned.scroll.scrollTop,230);
  assert.ok(motion.albumCoverTransfer.value.to);
  motion.reconcileAlbumCoverScroll();
  assert.ok(motion.albumCoverTransfer.value,'restoring the captured scroll is harmless');
  returned.rect.top-=40;
  motion.reconcileAlbumCoverScroll();
  assert.equal(motion.albumCoverTransfer.value,null);
  assert.equal(returned.attrs.size,0);
});

test('shelves only launch cover flights from fully visible cards after initialization',async t=>{
  const {motion,Cover}=await fixture(t),cover=new Cover(),shelf=new Cover(280,170,140,190);
  cover.shelf=shelf;
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),false,'initializing shelves cannot supply settled coordinates');
  shelf.attrs.add('data-home-shelf-ready');
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),false,'a partially clipped next card stays in the shelf');
  shelf.rect.right=600;
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),true);
  motion.cancelAlbumCoverTransition();
  cover.rect.left=-10;
  assert.equal(motion.beginAlbumCoverTransition('a',cover,'album'),false,'partially visible browser-edge images do not flash as full overlays');
});

test('Home return waits for shelf restoration before measuring the destination',async t=>{
  const {motion,Cover,cards,flush}=await fixture(t),source=new Cover(),hero=new Cover(330,110,240,240);
  source.scroll={scrollTop:230,scrollLeft:0};
  motion.beginAlbumCoverTransition('a',source,'album');motion.cancelAlbumCoverTransition();
  motion.beginAlbumCoverTransition('a',hero,'home');hero.isConnected=false;
  const returned=new Cover(),shelf=new Cover(280,170,600,190);
  returned.dataset.homeAlbumCover='a';returned.scroll={scrollTop:0,scrollLeft:0};returned.shelf=shelf;cards.push(returned);
  motion.arriveHomeAlbumCoverTransition();
  assert.equal(motion.albumCoverTransfer.value.to,null);
  assert.equal(returned.scroll.scrollTop,0);
  assert.equal(returned.attrs.size,0);
  shelf.attrs.add('data-home-shelf-ready');flush();
  assert.equal(returned.scroll.scrollTop,230);
  assert.equal(motion.albumCoverTransfer.value.to.left,300);
  assert.ok(returned.attrs.has('data-cover-flight-hidden'));
});

test('a destination clipped by the scroll viewport falls back without hiding its cover',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {motion,Cover}=await fixture(t),source=new Cover(),target=new Cover(300,570,150,150);
  target.scroll=new Cover(0,40,1280,620);
  motion.beginAlbumCoverTransition('a',source,'album');
  motion.finishAlbumCoverTransition('a',target);
  assert.equal(motion.albumCoverTransfer.value.to,null);
  assert.equal(target.attrs.size,0);
  t.mock.timers.tick(1801);
  assert.equal(motion.albumCoverTransfer.value,null);
  assert.equal(source.attrs.size,0);
});
