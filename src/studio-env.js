// A bright "photo studio" environment for the chrome animals: a soft grey dome plus a few
// large HDR softboxes. Rendered once through PMREMGenerator and used as scene.environment,
// which is what fully-metallic materials reflect. Colour values above 1 are intentional (HDR).
import {BackSide, Color, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, SphereGeometry} from 'three'

export function makeStudioEnvironment() {
  const scene = new Scene()
  scene.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({color: new Color(0.16, 0.16, 0.18), side: BackSide})))
  const softbox = (w, h, x, y, z, brightness) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({color: new Color(brightness, brightness, brightness)}))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  softbox(8, 8, 0, 10, 0, 5)         // big top light
  softbox(4, 10, -10, 4, 5, 4)       // key, upper left, slightly in front
  softbox(4, 10, 10, 2, 5, 2.5)      // fill, right
  softbox(12, 2.5, 0, 3, 12, 4)      // strip in front of the subject: highlights facing the viewer
  softbox(3, 8, 0, 1, -12, 2)        // rim from behind
  softbox(12, 12, 0, -10, 0, 0.5)    // floor bounce
  return scene
}
