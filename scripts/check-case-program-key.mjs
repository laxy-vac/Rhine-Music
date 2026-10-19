import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
const result=await build({stdin:{contents:'export { musicCaseLightVariant, musicCaseProgramKey } from "./src/music-case-program-key.ts";export { MusicSelectionLighting } from "./src/music-lighting.ts";export * as THREE from "three";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {musicCaseLightVariant:variant,musicCaseProgramKey:key,MusicSelectionLighting,THREE}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const lighting=new MusicSelectionLighting(new THREE.Scene());
const code=surface=>{const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};lighting.shade(shader,surface,new THREE.MeshPhysicalMaterial());return[shader.vertexShader,shader.fragmentShader,Object.keys(shader.uniforms)];};
const a='Punk | raised pearl white emblem',b='Punk | graphite ink and vent recess';assert.deepEqual(code(a),code(b));assert.equal(key(a,'array',false,true),key(b,'array',false,true));assert.notEqual(key(a,'array',false,false),key(b,'array',false,false));
const asset=fs.readFileSync('public/assets/punk-reference-case.glb'),gltf=JSON.parse(asset.subarray(20,20+asset.readUInt32LE(12)).toString()),groups=new Map();
for(const material of gltf.materials){const surface=material.name.replace(/\.\d+$/,'');const group=variant(surface),shader=code(surface);if(groups.has(group))assert.deepEqual(shader,groups.get(group));else groups.set(group,shader);}
const cases=['Album_Print','Frosted_Polymer','Ivory_Edges',a];assert.equal(new Set(cases.map(variant)).size,4);for(let i=0;i<cases.length;i++)for(let j=i+1;j<cases.length;j++)assert.notDeepEqual(code(cases[i]),code(cases[j]));
// Sharing compiled code must not couple two materials' live optical settings.
const left=new THREE.MeshPhysicalMaterial({transmission:.12}),right=new THREE.MeshPhysicalMaterial({transmission:.91});
const makeShader=()=>({uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'});
const leftShader=makeShader(),rightShader=makeShader();lighting.shade(leftShader,a,left);lighting.shade(rightShader,b,right);
assert.notEqual(leftShader.uniforms.musicOpticalScatter,rightShader.uniforms.musicOpticalScatter);
assert.equal(leftShader.uniforms.musicOpticalScatter.value,.12);assert.equal(rightShader.uniforms.musicOpticalScatter.value,.91);
left.transmission=.48;assert.equal(leftShader.uniforms.musicOpticalScatter.value,.48);assert.equal(rightShader.uniforms.musicOpticalScatter.value,.91);
left.dispose();right.dispose();
assert.notEqual(key(a,'array',false,true),key(a,'selected',false,true));assert.notEqual(key(a,'array',false,true),key(a,'array',true,true));
console.log('Case program keys passed: identical light shader code shares a key; print/glass/spine, instancing mode and gold remain distinct.');
