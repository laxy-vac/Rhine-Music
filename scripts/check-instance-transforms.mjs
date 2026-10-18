import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result=await build({stdin:{contents:'export { MusicInstanceTransforms } from "./src/music-instance-transforms.ts"; export { InstancedMesh, BoxGeometry, MeshBasicMaterial, Matrix4 } from "three";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {MusicInstanceTransforms,InstancedMesh,BoxGeometry,MeshBasicMaterial,Matrix4}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const geometry=new BoxGeometry(),material=new MeshBasicMaterial(),meshes=Array.from({length:4},()=>new InstancedMesh(geometry,material,3)),short=new InstancedMesh(geometry,material,1);
const controller=new MusicInstanceTransforms(),shared=controller.bind([...meshes,short]);
assert.ok(meshes.every(m=>m.instanceMatrix===shared));assert.notEqual(short.instanceMatrix,shared);
const pose=new Matrix4().makeTranslation(2,3,4);meshes[0].setMatrixAt(1,pose);
for(const m of meshes){const got=new Matrix4();m.getMatrixAt(1,got);assert.deepEqual(got.elements,pose.elements);}
controller.enabled=false;controller.bind(meshes);assert.equal(new Set(meshes.map(m=>m.instanceMatrix)).size,4);
meshes[0].setMatrixAt(1,new Matrix4());const kept=new Matrix4();meshes[1].getMatrixAt(1,kept);assert.deepEqual(kept.elements,pose.elements);
controller.enabled=true;controller.bind(meshes);assert.ok(meshes.every(m=>m.instanceMatrix===meshes[0].instanceMatrix));
for(const m of [...meshes,short])m.dispose();geometry.dispose();material.dispose();
console.log('Instance transforms passed: shared pose values, capacity fallback, independent diagnostic buffers and rebinding.');
