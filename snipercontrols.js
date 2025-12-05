
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
    const MAG_SIZE = 10;
    let magAmmo = MAG_SIZE;
    let reserveAmmo = 10;
    let reloading = false;
    const bullets = [];
    const bulletSpeed = 200; // units per second
    const bulletTTL = 6; // seconds
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
    const totalTargets = 5;
    for (let i = 0; i < totalTargets; i++) {
      const x = (i - (totalTargets - 1) / 2) * 4; // -8, -4, 0, 4, 8
      const z = -30 - i * 8; // -30, -38, -46, ...
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
