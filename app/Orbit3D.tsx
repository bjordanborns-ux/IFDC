"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vec3 } from "./orbital";

const ISS_MODEL = "/models/ISS_stationary.glb";
const EARTH_MODEL = "/models/earth.glb";
const EARTH_RADIUS_KM = 6378.137;
const EARTH_SCENE_RADIUS = 2;

type Orbit3DProps = {
  positionEci: Vec3;
  velocityEci: Vec3;
  gmst: number;
  mode: "CHASE" | "NADIR";
};

// ECI uses Z through the north pole. Three.js uses Y as its vertical axis.
function eciToThree(
  vector: Vec3,
  scale = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM,
) {
  return new THREE.Vector3(
    vector.x * scale,
    vector.z * scale,
    -vector.y * scale,
  );
}

function normalizeModel(root: THREE.Object3D, diameter: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = diameter / Math.max(size.x, size.y, size.z);
  root.scale.setScalar(scale);
  root.position.copy(center).multiplyScalar(-scale);
}

export default function Orbit3D(props: Orbit3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const state = useRef(props);
  state.current = props;

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2", { antialias: true }) ||
      canvas.getContext("webgl", { antialias: true });
    if (!context) {
      host.innerHTML =
        '<div class="fallback-earth"><b>3D VIEW REQUIRES WEBGL</b></div>';
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000207);
    const camera = new THREE.PerspectiveCamera(38, 2, 0.01, 100);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.minDistance = 0.06;
    controls.maxDistance = 5;

    scene.add(new THREE.AmbientLight(0x8298b0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    const badge = host.querySelector(".three-badge");
    let earthLoaded = false;
    let issLoaded = false;
    const updateBadge = () => {
      if (!badge) return;
      badge.textContent =
        earthLoaded && issLoaded
          ? "ECI / GMST SYNC • LVLH ATTITUDE PROXY"
          : "LOADING LOCAL 3D ASSETS…";
    };

    const loader = new GLTFLoader();
    const earthRoot = new THREE.Group();
    scene.add(earthRoot);
    const fallbackEarth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 64, 32),
      new THREE.MeshPhongMaterial({ color: 0x31577b, shininess: 5 }),
    );
    earthRoot.add(fallbackEarth);

    loader.load(
      EARTH_MODEL,
      ({ scene: model }) => {
        normalizeModel(model, EARTH_SCENE_RADIUS * 2);
        model.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) object.frustumCulled = false;
        });
        earthRoot.add(model);
        fallbackEarth.visible = false;
        earthLoaded = true;
        updateBadge();
      },
      undefined,
      () => {
        earthLoaded = true;
        if (badge) badge.textContent = "EARTH GLB ERROR • SAFE SPHERE ACTIVE";
      },
    );

    scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(2.025, 64, 32),
        new THREE.MeshBasicMaterial({
          color: 0x4e9fff,
          transparent: true,
          opacity: 0.09,
          side: THREE.BackSide,
        }),
      ),
    );

    const station = new THREE.Group();
    scene.add(station);
    const addFallbackIss = () => {
      const structure = new THREE.MeshStandardMaterial({ color: 0xd6d8d7 });
      const solar = new THREE.MeshStandardMaterial({ color: 0x162a55 });
      station.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.008), structure),
      );
      [-0.055, 0.055].forEach((x) => {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.004, 0.025),
          solar,
        );
        panel.position.x = x;
        station.add(panel);
      });
    };

    loader.load(
      ISS_MODEL,
      ({ scene: model }) => {
        // Deliberately exaggerated for visibility, but small enough to remain
        // inside the real SGP4 altitude clearance above the rendered globe.
        normalizeModel(model, 0.1);
        model.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          mesh.frustumCulled = false;
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          materials.forEach((material) => {
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          });
        });
        station.add(model);
        issLoaded = true;
        updateBadge();
      },
      undefined,
      () => {
        addFallbackIss();
        issLoaded = true;
        if (badge) badge.textContent = "ISS GLB ERROR • BACKUP MODEL ACTIVE";
      },
    );

    const orbitGeometry = new THREE.BufferGeometry();
    scene.add(
      new THREE.Line(
        orbitGeometry,
        new THREE.LineBasicMaterial({ color: 0xffef00 }),
      ),
    );

    let lastOrbitKey = "";
    function updateOrbit(position: THREE.Vector3, velocity: THREE.Vector3) {
      const key = `${position.x.toFixed(4)}:${position.y.toFixed(4)}:${position.z.toFixed(4)}`;
      if (key === lastOrbitKey) return;
      lastOrbitKey = key;

      const radial = position.clone().normalize();
      const normal = position.clone().cross(velocity).normalize();
      const tangent = normal.clone().cross(radial).normalize();
      const radius = position.length();
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 240; index += 1) {
        const angle = (index / 240) * Math.PI * 2;
        points.push(
          radial
            .clone()
            .multiplyScalar(Math.cos(angle) * radius)
            .add(tangent.clone().multiplyScalar(Math.sin(angle) * radius)),
        );
      }
      orbitGeometry.setFromPoints(points);
    }

    let animationFrame = 0;
    let cameraInitialized = false;
    const previousTarget = new THREE.Vector3();
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const draw = () => {
      resize();
      const position = eciToThree(state.current.positionEci);
      const velocity = eciToThree(state.current.velocityEci, 1);
      const radialOut = position.clone().normalize();
      const alongTrack = velocity
        .clone()
        .sub(radialOut.clone().multiplyScalar(velocity.dot(radialOut)))
        .normalize();
      const nadir = radialOut.clone().negate();
      const orbitNormal = position.clone().cross(velocity).normalize();

      station.position.copy(position);
      // LVLH proxy: X along velocity, Y orbit normal, Z toward nadir.
      station.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(alongTrack, orbitNormal, nadir),
      );
      updateOrbit(position, velocity);

      // Rotate the Earth-fixed model into the ECI scene using the same epoch GMST.
      earthRoot.rotation.set(0, state.current.gmst, 0);

      if (!cameraInitialized) {
        if (state.current.mode === "CHASE") {
          camera.position
            .copy(position)
            .addScaledVector(alongTrack, -0.34)
            .addScaledVector(radialOut, 0.13);
          camera.up.copy(orbitNormal);
        } else {
          camera.position
            .copy(position)
            .addScaledVector(alongTrack, -0.18)
            .addScaledVector(radialOut, 0.17);
          camera.up.copy(alongTrack);
        }
        controls.target.copy(position);
        previousTarget.copy(position);
        cameraInitialized = true;
      } else {
        // Translate the user's chosen camera offset with the ISS. This preserves
        // manual rotation and zoom instead of snapping back every animation frame.
        const targetMotion = position.clone().sub(previousTarget);
        camera.position.add(targetMotion);
        controls.target.copy(position);
        previousTarget.copy(position);
      }

      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(draw);
    };

    camera.position.set(3, 1.4, 3);
    updateBadge();
    draw();

    return () => {
      cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.dispose();
      orbitGeometry.dispose();
      host.replaceChildren();
    };
  }, []);

  return (
    <div ref={mount} className="three-host">
      <div className="three-badge">LOADING LOCAL 3D ASSETS…</div>
    </div>
  );
}
