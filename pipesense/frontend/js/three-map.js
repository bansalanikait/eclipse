/**
 * PIPE·SENSE v3 — Three.js 3D Pipe Map
 * Requires THREE from cdnjs r128 loaded globally (non-module)
 *
 * Views: 'gas' | 'tension' | 'wire'
 * Supports: SEWER mode and PIPELINE mode
 */

/* -------------------------------------------------------
   Module state
------------------------------------------------------- */
let _scene, _camera, _renderer, _animId;
let _nodes       = [];          // { x,y,z, packet, detections }
let _segMeshes   = [];          // pipe segment groups
let _anomaly3D   = [];          // anomaly marker objects
let _particleSystem = null;
let _particlePos    = null;
let _robotMarker    = null;
let _robotLight     = null;
let _camAngle       = 0;
let _camRadius      = 55;
let _camElevation   = 28;
let _camTarget      = new THREE.Vector3(0, 0, 0);
let _camTargetSmooth = new THREE.Vector3(0, 0, 0);
let _currentView    = 'gas';
let _mode           = 'sewer';
let _maxParticles   = 2000;
let _particleCount  = 0;
let _particleColors = null;
let _pipeGroup      = null;

// Orbit drag state
let _isDragging     = false;
let _dragStartX     = 0;
let _dragStartY     = 0;
let _dragStartAngle = 0;
let _dragStartElev  = 0;
let _lastInteract   = 0; // timestamp of last user interaction

/* -------------------------------------------------------
   Colors
------------------------------------------------------- */
const C = {
  safe:    0x00ff9d,
  warn:    0xff8c00,
  danger:  0xff2244,
  water:   0x2196f3,
  accent:  0x00d4ff,
  purple:  0x9c27b0,
  yellow:  0xffd700,
  pipe:    0x1a3a4a,
  pipeInner: 0x020608,
  robot:   0xffd700,
  bend:    0xffd700,
  high:    0xffff00,
};

/* -------------------------------------------------------
   Exported map object
------------------------------------------------------- */
export const threeMap = {
  nodeCount: 0,

  init(canvasId, mode) {
    _mode = mode;
    const canvas = document.getElementById(canvasId);
    const wrap   = canvas.parentElement;

    _scene    = new THREE.Scene();
    _scene.background = new THREE.Color(0x020608);
    _scene.fog = new THREE.FogExp2(0x020608, 0.018);

    _camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / wrap.clientHeight, 0.1, 500);
    _camera.position.set(0, 28, 55);
    _camera.lookAt(0, 0, 0);

    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    _renderer.shadowMap.enabled = true;

    // Lighting
    const ambient = new THREE.AmbientLight(0x0a1a28, 0.8);
    _scene.add(ambient);
    const dir = new THREE.DirectionalLight(0x00d4ff, 0.6);
    dir.position.set(10, 20, 10);
    _scene.add(dir);

    // Grid floor
    const grid = new THREE.GridHelper(200, 40, 0x0e2233, 0x0e2233);
    grid.position.y = -1.5;
    _scene.add(grid);

    // Pipe group
    _pipeGroup = new THREE.Group();
    _scene.add(_pipeGroup);

    // Particles system
    _initParticles();

    // Robot marker
    _initRobotMarker();

    // Start a minimal initial pipe segment at origin
    _addInitialSegment();

    // Handle resize
    const ro = new ResizeObserver(() => {
      _renderer.setSize(wrap.clientWidth, wrap.clientHeight);
      _camera.aspect = wrap.clientWidth / wrap.clientHeight;
      _camera.updateProjectionMatrix();
    });
    ro.observe(wrap);

    // ── Mouse / touch orbit controls ──────────────────────
    const onStart = (clientX, clientY) => {
      _isDragging     = true;
      _dragStartX     = clientX;
      _dragStartY     = clientY;
      _dragStartAngle = _camAngle;
      _dragStartElev  = _camElevation;
      _lastInteract   = Date.now();
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (clientX, clientY) => {
      if (!_isDragging) return;
      _lastInteract = Date.now();
      const dx = (clientX - _dragStartX) * 0.008;
      const dy = (clientY - _dragStartY) * 0.18;
      _camAngle     = _dragStartAngle + dx;
      _camElevation = Math.max(4, Math.min(90, _dragStartElev - dy));
    };
    const onEnd = () => {
      _isDragging = false;
      _lastInteract = Date.now();
      canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown',  e => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove',  e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup',    onEnd);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    canvas.addEventListener('touchend',   onEnd);

    // Scroll to zoom
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      _camRadius = Math.max(10, Math.min(150, _camRadius + e.deltaY * 0.08));
      _lastInteract = Date.now();
    }, { passive: false });

    // Start render loop
    _animate();

    // Active view button
    _updateViewButtons();
  },

  /** Call every time a new packet arrives */
  addNode(packet, detections) {
    const prevNode = _nodes.length ? _nodes[_nodes.length - 1] : null;

    // Position: use pre-computed coords from demo-data if present,
    // otherwise dead-reckon from heading + dist delta (live ESP32 mode).
    let x, y, z;
    if (typeof packet._x === 'number') {
      // Demo mode: demo-data writes _x/_y/_z into packet
      x = packet._x;
      y = packet._y;
      z = packet._z;
    } else {
      // Live mode: derive from heading + cumulative distance
      const headingRad = (packet.heading || 0) * Math.PI / 180;
      const dist       = packet.dist || 0;
      if (prevNode) {
        const step = Math.max(dist - (prevNode.packet.dist || 0), 0);
        x = prevNode.x + step * Math.sin(headingRad);
        z = prevNode.z + step * Math.cos(headingRad);
      } else {
        x = 0;
        z = 0;
      }
      y = (packet.pitch || 0) * 0.04;
    }

    // Guard: skip degenerate zero-length segments
    if (prevNode) {
      const dx  = x - prevNode.x;
      const dy  = y - prevNode.y;
      const dz  = z - prevNode.z;
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (len < 0.05) return; // too close — same position, skip
    }

    const node = { x, y, z, packet, detections };
    _nodes.push(node);
    this.nodeCount = _nodes.length;

    // Build pipe segment between last two nodes
    if (_nodes.length >= 2) {
      _buildSegment(_nodes[_nodes.length - 2], node, detections);
    }

    // Place anomaly markers
    if (detections) {
      _placeAnomalyMarkers(node, detections);
    }

    // Move robot
    _robotMarker.position.set(x, y + 0.7, z);
    _camTarget.set(x, y, z);

    // Scatter particles around current position
    _scatterParticles(node, detections);

    // Refresh view colors
    _applyView(_currentView);
  },

  setView(view) {
    _currentView = view;
    _applyView(view);
    _updateViewButtons();
    _updateLegend(view);
  },
};

/* -------------------------------------------------------
   Internal helpers
------------------------------------------------------- */

function _initParticles() {
  const geometry = new THREE.BufferGeometry();
  _particlePos    = new Float32Array(_maxParticles * 3);
  _particleColors = new Float32Array(_maxParticles * 3);
  const sizes   = new Float32Array(_maxParticles);

  for (let i = 0; i < _maxParticles; i++) {
    _particlePos[i * 3]     = 0;
    _particlePos[i * 3 + 1] = -999; // hidden below
    _particlePos[i * 3 + 2] = 0;
    sizes[i] = Math.random() * 0.25 + 0.08;
    _particleColors[i * 3]     = 0;
    _particleColors[i * 3 + 1] = 1;
    _particleColors[i * 3 + 2] = 0.6;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(_particlePos, 3));
  geometry.setAttribute('color',    new THREE.BufferAttribute(_particleColors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.18,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    sizeAttenuation: true,
  });

  _particleSystem = new THREE.Points(geometry, mat);
  _scene.add(_particleSystem);
  _particleCount = 0;
}

function _initRobotMarker() {
  const geo   = new THREE.SphereGeometry(0.7, 16, 16);
  const mat   = new THREE.MeshPhongMaterial({ color: C.robot, emissive: 0x443300, shininess: 80 });
  _robotMarker = new THREE.Mesh(geo, mat);

  _robotLight = new THREE.PointLight(C.robot, 5, 12);
  _robotMarker.add(_robotLight);
  _scene.add(_robotMarker);
}

function _addInitialSegment() {
  const seg = _makePipeSegment(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0.001),
    new THREE.Color(C.safe),
    new THREE.Color(C.safe),
    1.1,
    null
  );
  _pipeGroup.add(seg);
}

function _buildSegment(nodeA, nodeB, detections) {
  const a = new THREE.Vector3(nodeA.x, nodeA.y, nodeA.z);
  const b = new THREE.Vector3(nodeB.x, nodeB.y, nodeB.z);

  if (a.distanceTo(b) < 0.001) return;

  const gasColor = _nodeColor(nodeB, detections);

  // Tension colour: stress-based green→yellow→orange→red
  const mpa = _stressMPa(detections);
  let tensionColor;
  if      (detections && detections.bend && detections.bend.detected) tensionColor = new THREE.Color(0x9c27b0);
  else if (mpa < 70)  tensionColor = new THREE.Color(0x00e676);
  else if (mpa < 150) tensionColor = new THREE.Color(0xffeb3b);
  else if (mpa < 250) tensionColor = new THREE.Color(0xff6b00);
  else                tensionColor = new THREE.Color(0xff1744);

  // Base radius 1.1 (≈ 140 mm pipe at scene scale).
  // Stress swells the pipe slightly for visual feedback.
  const radius = 1.1 + (mpa / 350) * 0.25;

  const group = _makePipeSegment(a, b, gasColor, tensionColor, radius, detections);
  group.userData = { nodeB, detections, baseRadius: radius, gasColor, tensionColor };
  _segMeshes.push(group);
  _pipeGroup.add(group);

  // Joint torus at the end node
  const torus = _makeJointTorus(b, gasColor, radius);
  torus.userData = { isJoint: true, gasColor, tensionColor };
  _pipeGroup.add(torus);
  _segMeshes.push(torus);
}

function _makePipeSegment(a, b, gasColor, tensionColor, outerR, detections) {
  const dir    = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  if (length < 0.001) return new THREE.Group();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  dir.normalize();

  const group = new THREE.Group();
  group.position.copy(mid);
  const up = new THREE.Vector3(0, 1, 0);
  const q  = new THREE.Quaternion().setFromUnitVectors(up, dir);
  group.setRotationFromQuaternion(q);


  // ── Outer shell (dark semi-transparent steel, coloured in applyView) ──
  const outerGeo = new THREE.CylinderGeometry(outerR, outerR, length, 14, 1, false);
  const outerMat = new THREE.MeshPhongMaterial({
    color: 0x1a3a4a, transparent: true, opacity: 0.55, shininess: 60, specular: 0x004466
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.userData.role = 'outer';
  group.add(outerMesh);

  // ── Glowing end ring in gas detection colour ──
  const ringGeo = new THREE.TorusGeometry(outerR, outerR * 0.055, 8, 20);
  const ringMat = new THREE.MeshBasicMaterial({ color: gasColor, transparent: true, opacity: 0.85 });
  const ring    = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, length * 0.5, 0);
  ring.userData.role = 'ring';
  group.add(ring);

  // ── Inner bore ──
  const innerR   = outerR * 0.72;
  const innerGeo = new THREE.CylinderGeometry(innerR, innerR, length + 0.01, 14, 1, false);
  const innerMat = new THREE.MeshPhongMaterial({ color: C.pipeInner, side: THREE.BackSide });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.userData.role = 'inner';
  group.add(innerMesh);

  // ── Gas particles INSIDE the bore (like the reference) ──
  if (detections) {
    const gasLevel = detections.hole ? detections.hole.mq4Peak || 0 : 0;
    // Always add a baseline number of particles; more when gas is high
    const pCount = Math.max(2, Math.floor((gasLevel / 180) * 12));
    const perp1  = new THREE.Vector3(1, 0, 0);
    if (Math.abs(dir.x) > 0.9) perp1.set(0, 1, 0);
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
    const perp3 = new THREE.Vector3().crossVectors(dir, perp2).normalize();
    // Choose particle colour from gas level
    let pColor;
    if      (gasLevel < 200)  pColor = 0x00e676;
    else if (gasLevel < 500)  pColor = 0xffeb3b;
    else if (gasLevel < 1000) pColor = 0xff6b00;
    else                      pColor = 0xff1744;

    for (let i = 0; i < pCount; i++) {
      const pg  = new THREE.SphereGeometry(0.05 + Math.random() * 0.09, 5, 5);
      const pm  = new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 0.3 + Math.random() * 0.55 });
      const p   = new THREE.Mesh(pg, pm);
      const theta = Math.random() * Math.PI * 2;
      const r     = Math.random() * innerR * 0.82;
      const along = (Math.random() - 0.5) * length;
      p.position.set(Math.cos(theta) * r, along, Math.sin(theta) * r);
      p.userData.role = 'particle';
      group.add(p);
    }
  }

  return group;
}

function _makeJointTorus(pos, color, pipeR) {
  const r   = pipeR || 1.1;
  const geo = new THREE.TorusGeometry(r, r * 0.055, 8, 20);
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 40 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.userData.isJoint = true;
  return mesh;
}

function _nodeColor(node, detections) {
  if (!detections) return new THREE.Color(C.safe);
  return sensors.getNodeColor(detections, _mode);
}

function _stressMPa(detections) {
  return detections ? (detections.stressMPa || 0) : 0;
}

function _placeAnomalyMarkers(node, detections) {
  if (!detections) return;
  const pos = new THREE.Vector3(node.x, node.y, node.z);

  // Check nested .detected on the hole object
  if (detections.hole && detections.hole.detected) {
    const geo  = new THREE.TorusGeometry(1.1, 0.06, 8, 24);
    const mat  = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos);
    ring.userData.isPulseRing = true;
    ring.userData.birthTime   = Date.now();
    _scene.add(ring);
    _anomaly3D.push(ring);

    const light = new THREE.PointLight(0xff2244, 4, 8);
    light.position.copy(pos);
    _scene.add(light);
    _anomaly3D.push(light);
  }

  if (detections.blockage && detections.blockage.detected) {
    const geo  = new THREE.SphereGeometry(1.0, 12, 12);
    const mat  = new THREE.MeshPhongMaterial({ color: C.water, transparent: true, opacity: 0.45, emissive: 0x001133 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    _scene.add(mesh);
    _anomaly3D.push(mesh);

    const light = new THREE.PointLight(C.water, 3, 7);
    light.position.copy(pos);
    _scene.add(light);
    _anomaly3D.push(light);
  }

  if (detections.bend && detections.bend.detected) {
    const geo  = new THREE.TorusGeometry(0.9, 0.07, 8, 24);
    const mat  = new THREE.MeshBasicMaterial({ color: C.yellow });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos);
    _scene.add(ring);
    _anomaly3D.push(ring);
  }

  if (detections.stressMPa > 250) {
    const geo  = new THREE.SphereGeometry(0.9, 12, 12);
    const mat  = new THREE.MeshPhongMaterial({ color: C.purple, transparent: true, opacity: 0.4, emissive: 0x220033 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    _scene.add(mesh);
    _anomaly3D.push(mesh);
  }

  if (detections.corrosion && detections.corrosion.risk > 0.5) {
    const geo  = new THREE.SphereGeometry(0.8, 10, 10);
    const mat  = new THREE.MeshPhongMaterial({ color: C.warn, transparent: true, opacity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    _scene.add(mesh);
    _anomaly3D.push(mesh);
  }
}

function _scatterParticles(node, detections) {
  const gasLevel = node.packet.mq4 || 0;
  if (gasLevel < 50) return;

  const count = Math.min(8, Math.floor(gasLevel / 80));
  for (let i = 0; i < count; i++) {
    if (_particleCount >= _maxParticles) _particleCount = 0;
    const idx = _particleCount * 3;
    _particlePos[idx]     = node.x + (Math.random() - 0.5) * 1.2;
    _particlePos[idx + 1] = node.y + Math.random() * 0.5;
    _particlePos[idx + 2] = node.z + (Math.random() - 0.5) * 1.2;

    // Color by gas level
    let r, g, b;
    if (gasLevel < 300)      { r=0.00; g=1.00; b=0.62; }
    else if (gasLevel < 500) { r=1.00; g=0.84; b=0.00; }
    else if (gasLevel < 700) { r=1.00; g=0.55; b=0.00; }
    else                     { r=1.00; g=0.13; b=0.27; }

    _particleColors[idx]     = r;
    _particleColors[idx + 1] = g;
    _particleColors[idx + 2] = b;
    _particleCount++;
  }
  _particleSystem.geometry.attributes.position.needsUpdate = true;
  _particleSystem.geometry.attributes.color.needsUpdate    = true;
}

function _applyView(view) {
  if (!_segMeshes.length) return;

  const isWire    = view === 'wire';
  const isTension = view === 'tension';
  const isGas     = view === 'gas';

  _particleSystem.visible = isGas;

  _segMeshes.forEach(obj => {
    if (!obj.isGroup && !obj.isMesh) return;

    // ── WIREFRAME ──
    if (isWire) {
      obj.traverse(child => {
        if (child.isMesh) {
          child.material.wireframe   = true;
          child.material.transparent = false;
          child.material.opacity     = 1;
          if (child.userData.role === 'outer') {
            child.material.color.set(obj.userData.tensionColor || C.accent);
          } else if (child.userData.role === 'inner' || child.userData.role === 'particle') {
            child.visible = false;
          } else {
            child.material.color.set(C.accent);
          }
        }
      });
      return;
    } else {
      obj.traverse(child => {
        if (child.isMesh) {
          child.material.wireframe = false;
          child.visible = true;
        }
      });
    }

    // ── TENSION VIEW: solid colour outer shell, emissive glow ──
    if (isTension && obj.userData && obj.userData.tensionColor) {
      const col = obj.userData.tensionColor;
      const mpa = obj.userData.detections ? _stressMPa(obj.userData.detections) : 0;
      const emissiveIntensity = mpa > 150 ? 0.45 : mpa > 70 ? 0.22 : 0.1;
      obj.traverse(child => {
        if (!child.isMesh) return;
        if (child.userData.role === 'outer') {
          // Solid opaque pipe in stress colour
          child.material.color.set(col);
          child.material.transparent = false;
          child.material.opacity     = 1;
          child.material.emissive    = col;
          child.material.emissiveIntensity = emissiveIntensity;
          child.material.shininess   = 80;
        } else if (child.userData.role === 'ring') {
          child.material.color.set(col);
        } else if (child.userData.role === 'particle') {
          // Hide particles in tension view — they clutter the stress visualisation
          child.visible = false;
        } else if (child.userData.role === 'inner') {
          child.visible = true;
        }
      });
      return;
    }

    // ── GAS VIEW: restore original appearance ──
    if (isGas && obj.userData && obj.userData.gasColor) {
      obj.traverse(child => {
        if (!child.isMesh) return;
        if (child.userData.role === 'outer') {
          child.material.color.set(0x1a3a4a);
          child.material.transparent = true;
          child.material.opacity     = 0.55;
          child.material.emissive    = new THREE.Color(0x000000);
          child.material.emissiveIntensity = 0;
        } else if (child.userData.role === 'ring') {
          child.material.color.set(obj.userData.gasColor);
        } else if (child.userData.role === 'particle') {
          child.visible = true;
        } else if (child.userData.role === 'inner') {
          child.visible = true;
        }
      });
    }
  });

  // Anomaly markers always visible except in wireframe they stay
  _anomaly3D.forEach(obj => {
    if (obj.isMesh) obj.visible = true;
  });
}

function _updateViewButtons() {
  ['gas','tension','wire'].forEach(v => {
    const btn = document.getElementById('vb-' + v);
    if (btn) btn.classList.toggle('active', v === _currentView);
  });
}

function _updateLegend(view) {
  const title  = document.getElementById('legend-title');
  const legend = document.getElementById('overlay-legend');
  if (!title || !legend) return;

  if (view === 'gas') {
    title.textContent = 'Gas View';
    legend.querySelectorAll('.legend-item').forEach((item, i) => {
      const labels = ['< 300 ppm — Safe','300–500 ppm — Warn','500–700 ppm — Danger','> 700 ppm — Critical'];
      item.querySelector('.legend-msg') && (item.querySelector('.legend-msg').textContent = labels[i]);
    });
  } else if (view === 'tension') {
    title.textContent = 'Tension View';
  } else {
    title.textContent = 'Wireframe';
  }
}

/* -------------------------------------------------------
   Animation loop
------------------------------------------------------- */
function _animate() {
  _animId = requestAnimationFrame(_animate);

  // Auto-orbit resumes 3 seconds after last user interaction
  const idle = Date.now() - _lastInteract > 3000;
  if (idle && !_isDragging) {
    _camAngle += 0.0025;
  }

  // Smooth camera target follows robot
  _camTargetSmooth.lerp(_camTarget, 0.025);
  _camera.position.x = _camTargetSmooth.x + _camRadius * Math.sin(_camAngle);
  _camera.position.z = _camTargetSmooth.z + _camRadius * Math.cos(_camAngle);
  _camera.position.y = _camTargetSmooth.y + _camElevation;
  _camera.lookAt(_camTargetSmooth);

  // Float particles upward
  if (_particleCount > 0) {
    const pos = _particleSystem.geometry.attributes.position.array;
    for (let i = 0; i < _maxParticles; i++) {
      const iy = i * 3 + 1;
      if (pos[iy] > -900) {
        pos[iy] += 0.008;
        if (pos[iy] > 6) pos[iy] = -999; // reset
      }
    }
    _particleSystem.geometry.attributes.position.needsUpdate = true;
  }

  // Pulse rings
  const now = Date.now();
  _anomaly3D.forEach(obj => {
    if (obj.userData && obj.userData.isPulseRing) {
      const age = (now - obj.userData.birthTime) / 1000;
      const s   = 1 + (age % 1.5) * 0.5;
      obj.scale.setScalar(s);
      obj.material.opacity = Math.max(0, 0.8 - (age % 1.5) * 0.6);
    }
  });

  _renderer.render(_scene, _camera);
}
