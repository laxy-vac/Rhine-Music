import { trUi, ui } from "./i18n";
import * as THREE from "three";
import { COVER_SIZE, COVER_INSET, containCover } from "./cover-atlas";
import type { CaseRect } from "./case-layout.ts";
import type { MusicAlbum } from "./music-types";
import { createAlbumPrintMaterial } from "./music-model.ts";
import { createAlbumInsert } from "./album-insert.ts";

/** A viewer owns its own print and texture, independent of the array's selection. */
export class ViewerAlbumCover {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  readonly insert?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  readonly ready: Promise<void>;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private image?: HTMLImageElement;
  private disposed = false;

  constructor(
    readonly album: MusicAlbum,
    anisotropy = 1,
    layout: CaseRect = COVER_SIZE,
    thickness = 0,
  ) {
    this.canvas.width = 1024;
    this.canvas.height = 1024;
    this.paintPlaceholder();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, anisotropy);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(layout.width, layout.height).translate(
        layout.x,
        layout.y,
        layout.z,
      ),
      createAlbumPrintMaterial(this.texture),
    );
    this.mesh.name = "Album cover print";
    this.mesh.receiveShadow = true;
    this.mesh.userData.albumCover = true;
    this.mesh.userData.albumId = album.id;
    this.mesh.userData.assemblyPart = thickness > 0 ? "substrate" : "cover";
    this.mesh.userData.caseLayout = { ...layout };
    this.mesh.userData.coverDisposed = false;
    this.mesh.userData.coverStatus = album.coverUrl ? "loading" : "missing";
    if (thickness > 0) {
      this.insert = createAlbumInsert(layout, thickness);
      this.insert.name = "Album paper insert";
      this.insert.userData.albumId = album.id;
      this.insert.userData.assemblyPart = "substrate";
    }
    this.ready = this.load();
  }

  private paintPlaceholder() {
    const context = this.canvas.getContext("2d")!;
    const { width, height } = this.canvas;
    const margin = width * COVER_INSET,
      size = height - margin * 2,
      left = (width - size) / 2;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#c9c9c4";
    context.fillRect(left, margin, size, size);
    context.strokeStyle = "#f8f7f1";
    context.lineWidth = height / 180;
    for (const radius of [0.2, 0.04]) {
      context.beginPath();
      context.arc(width / 2, height * 0.43, height * radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = "#3f4849";
    context.textAlign = "center";
    context.font = "500 34px sans-serif";
    context.fillText(
      this.album.title || trUi("暂无专辑封面"),
      width / 2,
      height * 0.8,
      height * 0.83,
    );
    context.font = "19px sans-serif";
    context.fillText(
      "LOCAL COLLECTION / NO COVER",
      width / 2,
      height * 0.87,
      height * 0.83,
    );
  }

  private async load() {
    if (!this.album.coverUrl) return;
    const image = new Image();
    this.image = image;
    image.crossOrigin = "anonymous";
    image.src = this.album.coverUrl;
    try {
      await image.decode();
      if (this.disposed || this.mesh.userData.coverDisposed) return;
      const context = this.canvas.getContext("2d")!;
      const { width, height } = this.canvas;
      const margin = width * COVER_INSET;
      const box = containCover(
        image.naturalWidth,
        image.naturalHeight,
        width - margin * 2,
        height - margin * 2,
      );
      context.clearRect(0, 0, width, height);
      context.drawImage(image, box.x + margin, box.y + margin, box.width, box.height);
      this.mesh.userData.coverStatus = "loaded";
      this.mesh.userData.coverImageSize = [
        image.naturalWidth,
        image.naturalHeight,
      ];
      this.texture.needsUpdate = true;
    } catch {
      if (!this.disposed) this.mesh.userData.coverStatus = "missing";
      // Keep this album's explicit missing-cover print; never reuse another album.
    } finally {
      image.src = "";
      if (this.image === image) this.image = undefined;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.userData.coverDisposed = true;
    if (this.image) this.image.src = "";
    this.mesh.removeFromParent();
    this.insert?.removeFromParent();
    this.texture.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.insert?.material.dispose();
    this.insert?.geometry.dispose();
    this.canvas.width = this.canvas.height = 1;
  }
}
