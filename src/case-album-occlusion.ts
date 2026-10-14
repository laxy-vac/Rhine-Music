/** Cosine-weighted visibility of the actual rectangular paper insert.
 * This removes blocked indirect light; direct light keeps its shadow-map path.
 * The polygon form factor is exact for a receiver facing the parallel card.
 * It approximates indirect visibility on the case's beveled interior edges. */
export const caseAlbumOcclusionGLSL = `
uniform vec4 caseAlbumRect;
uniform float caseAlbumDepth;
uniform float caseAlbumPresent;
varying vec3 vCaseGeometryPosition;
varying vec3 vCaseGeometryNormal;
float caseCardEdge(vec3 a, vec3 b, vec3 receiverNormal) {
  vec3 edgeNormal=cross(a,b);
  float edgeLength=length(edgeNormal);
  return atan(edgeLength,clamp(dot(a,b),-1.0,1.0))
    *dot(edgeNormal,receiverNormal)/max(edgeLength,1e-7);
}
float caseAlbumVisibility() {
  if(caseAlbumPresent<.5 || vCaseGeometryPosition.z>=caseAlbumDepth-1e-5) return 1.0;
  vec3 p=vCaseGeometryPosition;
  vec3 a=normalize(vec3(caseAlbumRect.xy,caseAlbumDepth)-p);
  vec3 b=normalize(vec3(caseAlbumRect.zy,caseAlbumDepth)-p);
  vec3 c=normalize(vec3(caseAlbumRect.zw,caseAlbumDepth)-p);
  vec3 d=normalize(vec3(caseAlbumRect.xw,caseAlbumDepth)-p);
  vec3 n=normalize(vCaseGeometryNormal);
  float blocked=(caseCardEdge(a,b,n)+caseCardEdge(b,c,n)
    +caseCardEdge(c,d,n)+caseCardEdge(d,a,n))/6.28318530718;
  return clamp(1.0-blocked,0.0,1.0);
}
`;

export const caseAlbumOcclusionApplyGLSL = `
float caseIndirectVisibility=caseAlbumVisibility();
reflectedLight.indirectDiffuse*=caseIndirectVisibility;
#ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect*=caseIndirectVisibility;
#endif
#if defined(USE_ENVMAP) && defined(STANDARD)
  reflectedLight.indirectSpecular*=computeSpecularOcclusion(
    saturate(dot(geometryNormal,geometryViewDir)),caseIndirectVisibility,material.roughness);
#endif
`;
