
  (function () {
    // Basic setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x88ccee);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.rotation.order = "YXZ";

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Camera holder objects for yaw and pitch
    const cameraHolder = new THREE.Object3D();
    const pitchObject = new THREE.Object3D();
    pitchObject.add(camera);
    cameraHolder.add(pitchObject);
    cameraHolder.position.set(0, 1.6, 0); // player eye height
    scene.add(cameraHolder);

    // Lights
    const ambient = new THREE.HemisphereLight(0xffffff, 0x444466, 0.8);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(20, 40, 10);
    sun.castShadow = true;
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.position.y = -0.01;
    scene.add(ground);

    // Simple environment objects (for depth/visual)
    function addCrate(x, z) {
      const geo = new THREE.BoxGeometry(2, 2, 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 1, z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    addCrate(8, -10); addCrate(-6, -18); addCrate(12, -28);

    // Gun (attach to camera)
    function createGun() {
      const gun = new THREE.Group();

      const metal = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.9, roughness: 0.4 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.6 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 1.2), metal);
      body.position.set(0.25, -0.16, -0.5);
      body.castShadow = true; body.receiveShadow = false;
      gun.add(body);

      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.1, 12), dark);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.9, -0.18, -0.05);
      barrel.castShadow = true;
      gun.add(barrel);

      // Scope
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 12), metal);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0.05, -0.06, -0.35);
      gun.add(scope);

      // stock
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.65), metal);
      stock.position.set(-0.3, -0.2, -0.9);
      gun.add(stock);

      // tip helper (barrel end)
      const tip = new THREE.Object3D();
      tip.position.set(1.45, -0.18, -0.05); // forward tip from gun origin
      gun.add(tip);
      gun.userData.tip = tip;

      // initial transform when attached to camera
      gun.position.set(0.2, -0.14, -0.4);
      gun.userData.initialPos = gun.position.clone();
      gun.userData.initialRot = gun.rotation.clone();
      gun.userData.recoil = { active: false, t: 0 };
      gun.userData.reload = { active: false, t: 0, duration: 1.3 };

      return gun;
    }

    const gun = createGun();
    camera.add(gun);

    // Ammo/Bullets targets
    const MAG_SIZE = 15;
    let magAmmo = MAG_SIZE;
    let reserveAmmo = 15;
    let reloading = false;
    const bullets = [];
    const bulletSpeed = 200; // units per second
    const bulletTTL = 0.5; // seconds
    let hitCount = 0;

    // DOM elements
    const startBtn = document.getElementById('startBtn');
    const crosshair = document.getElementById('crosshair');
    const scopeEl = document.getElementById('scope');
    const magEl = document.getElementById('mag');
    const reserveEl = document.getElementById('reserve');
    const hitCounterEl = document.getElementById('hitCounter');
    const statusMsg = document.getElementById('statusMsg');

    function updateUI() {
      magEl.textContent = magAmmo;
      reserveEl.textContent = reserveAmmo;
      hitCounterEl.textContent = hitCount;
    }
    updateUI();

    // Targets: boards facing the player
    const targetGroups = [];
    const targetMeshes = []; // the visible board plane meshes (for intersection)
    function createTarget(index, x, z) {
      const grp = new THREE.Group();
      grp.position.set(x, 1.5, z);
      grp.userData.index = index;
      grp.userData.hit = false;
      grp.userData.falling = false;
      grp.userData.angularVel = 0;
      grp.userData.velY = 0;

      // bullseye canvas texture
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
      const center = 256;
      for (let r = 0; r < 6; r++) {
        ctx.beginPath();
        ctx.fillStyle = (r % 2 === 0) ? '#ff3333' : '#ffffff';
        ctx.arc(center, center, 200 - r * 30, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#111'; ctx.lineWidth = 8;
      ctx.strokeRect(10, 10, 492, 492);

      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;

      const boardMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), boardMat);
      board.userData.targetIndex = index;
      board.castShadow = true;
      board.receiveShadow = true;
      grp.add(board);

      // backing thick panel
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.6, 0.12), new THREE.MeshStandardMaterial({ color: 0x5b3f2c }));
      back.position.set(0, 0, -0.07);
      grp.add(back);

      // stand
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      stand.position.set(0, -2.0, 0.0);
      stand.castShadow = true;
      grp.add(stand);

      scene.add(grp);
      targetGroups.push(grp);
      targetMeshes.push(board);
    }

    // Create 5 targets spaced across and at different distances
    const totalTargets = 15;
    for (let i = 0; i < totalTargets; i++) {
      const x = (i - (totalTargets - 1) / 2) * 4; // -8, -4, 0, 4, 8
      const z = -30 - i * 5; // -30, -35, -40, ...
      createTarget(i, x, z);
    }

    // Input + Pointer Lock
    const canvas = renderer.domElement;
    startBtn.addEventListener('click', () => {
      canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        startBtn.style.display = 'none';
        crosshair.style.display = 'block';
        statusMsg.style.display = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mousedown', onMouseDown);
      } else {
        startBtn.style.display = 'block';
        crosshair.style.display = 'none';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mousedown', onMouseDown);
      }
    });

    function onMouseMove(e) {
      if (document.pointerLockElement !== canvas) return;
      // mouse look
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      yaw -= mx * 0.0022;
      pitch -= my * 0.0022;
      const maxPitch = Math.PI / 2 - 0.05;
      pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
      cameraHolder.rotation.y = yaw;
      pitchObject.rotation.x = pitch;
    }

    function onMouseDown(e) {
      if (e.button === 0) shoot();
    }

    let yaw = 0, pitch = 0;
    // Movement (WASD)
    const keys = {};
    window.addEventListener('keydown', (ev) => {
      keys[ev.code] = true;
      if (ev.code === 'KeyR') startReload();
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') setScoped(true);
    });
    window.addEventListener('keyup', (ev) => {
      keys[ev.code] = false;
      if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') setScoped(false);
    });

    // Scoping (hold Shift)
    let scoped = false;
    function setScoped(on) {
      scoped = on;
      // UI handled via zoom smoothing in animation loop
      if (on) {
        scopeEl.style.display = 'block';
        crosshair.style.display = 'none';
      } else {
        scopeEl.style.display = 'none';
        crosshair.style.display = 'block';
      }
    }

    // Shooting
    function shoot() {
      if (reloading || gun.userData.reload.active) return;
      if (magAmmo <= 0) {
        flashStatus("Empty! Press R to reload");
        return;
      }
      magAmmo--;
      updateUI();

      // create bullet
      const origin = new THREE.Vector3();
      camera.getWorldPosition(origin); // eye position
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const spawn = origin.clone().add(dir.clone().multiplyScalar(1.2)); // a bit in front of eye

      const bulletGeo = new THREE.SphereGeometry(0.05, 8, 8);
      const bulletMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd77a, metalness: 0.2, roughness: 0.3 });
      const bullet = new THREE.Mesh(bulletGeo, bulletMat);
      bullet.position.copy(spawn);
      bullet.castShadow = true;
      bullet.userData.velocity = dir.clone().multiplyScalar(bulletSpeed);
      bullet.userData.prevPos = spawn.clone();
      bullet.userData.ttl = bulletTTL;
      bullet.userData.travelled = 0;
      bullets.push(bullet);
      scene.add(bullet);

      // muzzle flash (short lived)
      spawnMuzzleFlash(spawn);

      // gun recoil start
      gun.userData.recoil.active = true;
      gun.userData.recoil.t = 0;

      // immediate raycast (to detect hits easily even at high speed)
      const ray = new THREE.Raycaster(origin, dir, 0, 2000);
      const hits = ray.intersectObjects(targetMeshes, true);
      if (hits.length > 0) {
        // mark the bullet with its target so it visually travels to the hit for realism
        const hit = hits[0];
        bullet.userData.targetHit = {
          index: hit.object.userData.targetIndex,
          point: hit.point.clone(),
          distance: hit.distance
        };
      }
    }

    // Muzzle flash
    const tempEffects = [];
    function spawnMuzzleFlash(pos) {
      const geo = new THREE.SphereGeometry(0.12, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
      const flash = new THREE.Mesh(geo, mat);
      flash.position.copy(pos);
      flash.scale.setScalar(0.1);
      flash.userData.life = 0.08;
      scene.add(flash);
      tempEffects.push(flash);
    }

    // Impact (hit) effect / bullet hole
    function createImpact(point) {
      const impactGeo = new THREE.CircleGeometry(0.12, 12);
      const impactMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const hole = new THREE.Mesh(impactGeo, impactMat);
      hole.position.copy(point).add(new THREE.Vector3(0, 0, 0));
      // orient slightly to camera normal for visibility
      hole.lookAt(camera.position);
      hole.rotateX(Math.PI / 2);
      hole.userData.life = 6.0;
      scene.add(hole);
      tempEffects.push(hole);
    }

    // Target hit handling
    function handleTargetHit(index, hitPoint) {
      const grp = targetGroups[index];
      if (!grp || grp.userData.hit) return;
      grp.userData.hit = true;
      grp.userData.falling = true;
      grp.userData.angularVel = (Math.random() * 2 + 2) * (Math.random() > 0.5 ? 1 : -1);
      grp.userData.velY = -1.0 * (Math.random() * 0.8 + 0.3);
      hitCount++;
      updateUI();

      // small debris: spawn 3 tiny cubes
      for (let i = 0; i < 3; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0x8b5a3c }));
        d.position.copy(hitPoint).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.5));
        d.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2.5, (Math.random() - 0.5) * 2.5);
        d.userData.life = 1.5;
        scene.add(d);
        tempEffects.push(d);
      }
    }

    // Reload logic & animation
    function startReload() {
      if (reloading || magAmmo === MAG_SIZE || reserveAmmo <= 0) return;
      reloading = true;
      gun.userData.reload.active = true;
      gun.userData.reload.t = 0;
      flashStatus("Reloading...");
    }

    function flashStatus(text, time = 1200) {
      statusMsg.textContent = text;
      statusMsg.style.display = 'block';
      setTimeout(() => { statusMsg.style.display = 'none'; }, time);
    }

    // Movement update
    const moveState = { vel: new THREE.Vector3(0, 0, 0) };
    function updateMovement(dt) {
      const moveSpeed = 6.0;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraHolder.quaternion).setY(0).normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraHolder.quaternion).setY(0).normalize();
      let moveDir = new THREE.Vector3();
      if (keys['KeyW']) moveDir.add(forward);
      if (keys['KeyS']) moveDir.add(forward.clone().negate());
      if (keys['KeyA']) moveDir.add(right.clone().negate());
      if (keys['KeyD']) moveDir.add(right);
      if (moveDir.lengthSq() > 0) moveDir.normalize();
      const targetVel = moveDir.multiplyScalar(moveSpeed);
      moveState.vel.lerp(targetVel, Math.min(1, dt * 12));
      cameraHolder.position.add(moveState.vel.clone().multiplyScalar(dt));
      // keep roughly at eye height (no jumping)
      cameraHolder.position.y = 1.6;
    }

    // Update bullets and effects
    function updateBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const prev = b.userData.prevPos.clone();
        // if bullet had a precomputed target from initial raycast, we can fast-forward hit
        let displacement = b.userData.velocity.clone().multiplyScalar(dt);
        b.position.add(displacement);
        b.userData.travelled += displacement.length();

        // Raycast between prev and current
        const segment = b.position.clone().sub(prev);
        const dist = segment.length();
        if (dist > 0.0001) {
          const dir = segment.clone().normalize();
          const ray = new THREE.Raycaster(prev, dir, 0, dist + 0.01);
          const intersects = ray.intersectObjects(targetMeshes, true);
          if (intersects.length > 0) {
            const hit = intersects[0];
            createImpact(hit.point);
            handleTargetHit(hit.object.userData.targetIndex, hit.point);
            // remove bullet
            scene.remove(b);
            bullets.splice(i, 1);
            continue;
          }
        }

        // If initial precomputed target exists, check if we've reached its distance to trigger hit (useful for fast bullets)
        if (b.userData.targetHit) {
          if (b.userData.travelled >= b.userData.targetHit.distance - 0.2) {
            createImpact(b.userData.targetHit.point);
            handleTargetHit(b.userData.targetHit.index, b.userData.targetHit.point);
            scene.remove(b);
            bullets.splice(i, 1);
            continue;
          }
        }

        b.userData.prevPos.copy(b.position);
        b.userData.ttl -= dt;
        if (b.userData.ttl <= 0) {
          scene.remove(b);
          bullets.splice(i, 1);
        }
      }

      // update temp effects (muzzle flash/holes/debris)
      for (let i = tempEffects.length - 1; i >= 0; i--) {
        const e = tempEffects[i];
        if (e.userData.life !== undefined) {
          e.userData.life -= dt;
          if (e.userData.vel) {
            // debris physics
            e.position.add(e.userData.vel.clone().multiplyScalar(dt));
            e.userData.vel.y -= 9.81 * dt;
          }
          if (e.userData.life <= 0) {
            scene.remove(e);
            tempEffects.splice(i, 1);
          } else {
            // scale or fade muzzle flash
            if (e.geometry.type === 'SphereGeometry') {
              // muzzle flash: scale down quickly
              const frac = Math.max(0, e.userData.life / 0.08);
              e.scale.setScalar(0.6 * (1 - frac * 0.8));
              e.material.opacity = Math.max(0.2, frac);
              e.material.transparent = true;
            } else if (e.geometry.type === 'CircleGeometry') {
              // bullet hole: slightly sink into surface
              // nothing needed
            } else {
              // debris can rotate
              e.rotation.x += 3 * dt;
              e.rotation.y += 1.5 * dt;
            }
          }
        }
      }
    }

    // Update targets: face player, fall down when hit
    function updateTargets(dt) {
      for (let i = 0; i < targetGroups.length; i++) {
        const grp = targetGroups[i];
        if (!grp) continue;
        if (!grp.userData.falling) {
          // always face player (only the board - whole group for simplicity)
          const lookPos = cameraHolder.position.clone();
          lookPos.y = grp.position.y; // avoid tilting up/down too much
          grp.lookAt(lookPos);
        } else {
          // falling animation — rotate and translate downward like tipping over
          grp.rotation.x += grp.userData.angularVel * dt * 0.6;
          grp.position.y += grp.userData.velY * dt;
          grp.userData.velY -= 10 * dt; // gravity
          // stop after it hits ground-ish
          if (grp.position.y < -3) {
            // keep lying on ground
            grp.userData.falling = false;
          }
        }
      }
    }

    // Update gun recoil and reload animations
    function updateGun(dt) {
      // recoil
      if (gun.userData.recoil.active) {
        gun.userData.recoil.t += dt;
        const d = gun.userData.recoil.t;
        const duration = 0.14;
        if (d >= duration) {
          gun.userData.recoil.active = false;
          gun.position.copy(gun.userData.initialPos);
          gun.rotation.copy(gun.userData.initialRot);
        } else {
          const t = Math.sin((d / duration) * Math.PI);
          gun.position.z = gun.userData.initialPos.z + t * 0.14;
          gun.rotation.x = -t * 0.04;
        }
      }

      // reload animation
      if (gun.userData.reload.active) {
        gun.userData.reload.t += dt;
        const progress = Math.min(1, gun.userData.reload.t / gun.userData.reload.duration);
        // move gun down and slightly out and back
        gun.position.y = gun.userData.initialPos.y - Math.sin(progress * Math.PI) * 0.28;
        gun.position.x = gun.userData.initialPos.x - Math.sin(progress * Math.PI) * 0.07;
        if (progress >= 1) {
          gun.userData.reload.active = false;
          // actually refill mags
          const needed = MAG_SIZE - magAmmo;
          const take = Math.min(needed, reserveAmmo);
          magAmmo += take;
          reserveAmmo -= take;
          reloading = false;
          updateUI();
          flashStatus("Reloaded", 900);
          // restore initial pos
          gun.position.copy(gun.userData.initialPos);
        }
      }
    }

    // Zoom / scope smooth transition (change FOV)
    let targetFOV = camera.fov;
    function updateZoom(dt) {
      const desired = scoped ? 12 : 75;
      // smooth transition
      camera.fov += (desired - camera.fov) * Math.min(1, dt * 7.5);
      camera.updateProjectionMatrix();
      // hide scope when not fully scoped
      if (scoped) {
        scopeEl.style.display = 'block';
      } else {
        scopeEl.style.display = 'none';
      }
    }

    // small ephemeral status messages
    // (flashStatus already defined)

    // Resize handling
    window.addEventListener('resize', onResize);
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Main animation loop
    const clock = new THREE.Clock();
    function animate() {
      const dt = Math.min(0.05, clock.getDelta()); // cap delta for stability
      updateMovement(dt);
      updateBullets(dt);
      updateTargets(dt);
      updateGun(dt);
      updateZoom(dt);

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // Helpers: handle target hit triggered from other places too
    function handleTargetHit(index, hitPoint) {
      // collate duplicates gracefully
      const g = targetGroups[index];
      if (!g) return;
      if (g.userData.hit) return;
      // register hit
      g.userData.hit = true;
      g.userData.falling = true;
      g.userData.angularVel = (Math.random() * 3 + 2) * (Math.random() > 0.5 ? 1 : -1);
      g.userData.velY = -1.2 * (Math.random() * 0.8 + 0.2);
      hitCount++;
      updateUI();
    }

    // Expose a small keyboard helper (for demo): pressing H repositions the targets
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyH') {
        // reset targets
        for (let i = 0; i < targetGroups.length; i++) {
          const g = targetGroups[i];
          g.position.y = 1.5;
          g.rotation.set(0, 0, 0);
          g.userData.hit = false;
          g.userData.falling = false;
          g.userData.velY = 0;
        }
        hitCount = 0; updateUI();
      }
    });

    // Flash message on load
    flashStatus("Ready — click Start to play");

    // Click-to-shoot from outside pointerlock while testing (optional)
    // document.addEventListener('click', () => { if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); } });

    // Small optimization: hide scope overlay initially
    scopeEl.style.display = 'none';
    crosshair.style.display = 'none';

    // Camera starting orientation
    yaw = 0; pitch = 0;
    cameraHolder.position.set(0, 1.6, 6); // start a little back so you see targets
    // Look at the center in front
    cameraHolder.lookAt(new THREE.Vector3(0, 1.6, -10));

    // Expose some game information to window for debugging
    window.__sniper = {
      scene, camera, renderer, gun, bullets, targets: targetGroups
    };
  })();
