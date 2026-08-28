
        // --- GAME SETUP ---
        const container = document.getElementById('canvas-container');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);

        // --- LIGHTING ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        scene.add(dirLight);

        // --- ENVIRONMENT (Floating Island) ---
        const islandGroup = new THREE.Group();
        
        // Grass top
        const geoFloor = new THREE.CylinderGeometry(35, 38, 4, 16);
        const matFloor = new THREE.MeshStandardMaterial({ color: 0x557a2b, roughness: 0.8 });
        const floor = new THREE.Mesh(geoFloor, matFloor);
        floor.receiveShadow = true;
        islandGroup.add(floor);

        // Dirt bottom rock
        const geoRock = new THREE.CylinderGeometry(38, 2, 20, 16);
        const matRock = new THREE.MeshStandardMaterial({ color: 0x6e4f37, roughness: 0.9 });
        const rockBase = new THREE.Mesh(geoRock, matRock);
        rockBase.position.y = -11;
        islandGroup.add(rockBase);

        scene.add(islandGroup);

        // --- PROCEDURAL DINO MODEL GENERATOR ---
        function createDino(colorHex) {
            const group = new THREE.Group();
            const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 });
            const matYellow = new THREE.MeshStandardMaterial({ color: 0xffd700 });
            const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const matBlack = new THREE.MeshStandardMaterial({ color: 0x000000 });

            // Body
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.2), mat);
            body.position.y = 1;
            body.castShadow = true;
            group.add(body);

            // Head
            const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.4), mat);
            head.position.set(0, 1.9, 0.8);
            head.castShadow = true;
            group.add(head);

            // Snout (Spyro/Dino style)
            const snout = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.8), mat);
            snout.position.set(0, 1.7, 1.6);
            group.add(snout);

            // Eyes
            const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), matWhite);
            eyeL.position.set(0.56, 2.0, 0.8);
            const pupilL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), matBlack);
            pupilL.position.set(0.62, 2.0, 0.9);
            group.add(eyeL, pupilL);

            const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2), matWhite);
            eyeR.position.set(-0.56, 2.0, 0.8);
            const pupilR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), matBlack);
            pupilR.position.set(-0.62, 2.0, 0.9);
            group.add(eyeR, pupilR);

            // Horns/Spikes
            const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 4), matYellow);
            hornL.position.set(0.3, 2.5, 0.3);
            hornL.rotation.x = -0.3;
            const hornR = hornL.clone();
            hornR.position.x = -0.3;
            group.add(hornL, hornR);

            // Tail
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.5), mat);
            tail.position.set(0, 0.9, -1.5);
            tail.rotation.x = -0.2;
            group.add(tail);

            // Wings (Spyro style!)
            const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.0), matYellow);
            wingL.position.set(1.4, 1.5, -0.2);
            wingL.rotation.z = 0.3;
            wingL.rotation.y = 0.2;
            
            const wingR = wingL.clone();
            wingR.position.x = -1.4;
            wingR.rotation.z = -0.3;
            wingR.rotation.y = -0.2;

            group.add(wingL, wingR);

            // Core reference points for animating
            group.userData = { wingL: wingL, wingR: wingR, body: body };

            return group;
        }

        // --- SPAWN PLAYERS ---
        // Main Player (Green)
        const player = createDino(0x4CAF50);
        player.scale.set(1.5, 1.5, 1.5);
        scene.add(player);

        // Fake Multiplayer Network Clients (Other colors)
        const netPlayers = [
            { mesh: createDino(0x9C27B0), speed: 0.04, angle: 0, radius: 15, pivotX: 5, pivotZ: 5 },  // Purple
            { mesh: createDino(0xF44336), speed: 0.06, angle: 2, radius: 22, pivotX: -5, pivotZ: -5 }, // Red
            { mesh: createDino(0x00BCD4), speed: 0.03, angle: 4, radius: 10, pivotX: 10, pivotZ: -8 }  // Teal
        ];

        netPlayers.forEach(p => {
            scene.add(p.mesh);
        });

        // --- COLLECTIBLES (Gems) ---
        const gems = [];
        const gemColors = [0x9C27B0, 0x00BCD4, 0xF44336, 0x4CAF50, 0xFFEB3B];
        const gemGeometry = new THREE.OctahedronGeometry(0.4, 0);

        for (let i = 0; i < 25; i++) {
            const randColor = gemColors[Math.floor(Math.random() * gemColors.length)];
            const gemMaterial = new THREE.MeshStandardMaterial({ color: randColor, roughness: 0.1, metalness: 0.8 });
            const gemMesh = new THREE.Mesh(gemGeometry, gemMaterial);
            
            // Randomly scatter on the island circle
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 30;
            gemMesh.position.set(Math.cos(angle) * radius, 2.5, Math.sin(angle) * radius);
            
            scene.add(gemMesh);
            gems.push(gemMesh);
        }

        // --- PHYSICS & MOVEMENT VARIABLES ---
        let playerVelY = 0;
        let isGrounded = true;
        let score = 0;
        let matchTime = 60;
        let gameOver = false;
        let lastTick = Date.now();
        let moveInput = { x: 0, y: 0 };
        let isCharging = false;
        const gravity = -0.015;

        // --- INPUT PROCESSING (Desktop & Touch standardizer) ---
        const keys = { w: false, a: false, s: false, d: false, Shift: false };
        
        window.addEventListener('keydown', (e) => { 
            if(e.key === 'Spacebar' || e.key === ' ') triggerJump();
            if(e.key in keys) keys[e.key] = true; 
            if(e.key === 'Shift') isCharging = true;
        });
        window.addEventListener('keyup', (e) => { 
            if(e.key in keys) keys[e.key] = false; 
            if(e.key === 'Shift') isCharging = false;
        });

        // Touch Joystick Logic
        const joystickZone = document.getElementById('joystick-zone');
        const joystickKnob = document.getElementById('joystick-knob');
        let joystickActive = false;
        let touchStartPos = { x: 0, y: 0 };

        joystickZone.addEventListener('touchstart', (e) => {
            joystickActive = true;
            const touch = e.touches[0];
            const rect = joystickZone.getBoundingClientRect();
            touchStartPos = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
        });

        window.addEventListener('touchmove', (e) => {
            if (!joystickActive) return;
            const touch = e.touches[0];
            
            let dirX = touch.clientX - touchStartPos.x;
            let dirY = touch.clientY - touchStartPos.y;
            const distance = Math.min(Math.sqrt(dirX*dirX + dirY*dirY), 50); // clamp distance
            
            const angle = Math.atan2(dirY, dirX);
            const knobX = Math.cos(angle) * distance;
            const knobY = Math.sin(angle) * distance;

            joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

            // Normalize input values between -1 and 1
            moveInput.x = knobX / 50;
            moveInput.y = knobY / 50;
        });

        window.addEventListener('touchend', () => {
            joystickActive = false;
            joystickKnob.style.transform = `translate(0px, 0px)`;
            moveInput = { x: 0, y: 0 };
        });

        // Touch Action Buttons
        document.getElementById('btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); triggerJump(); });
        document.getElementById('btn-charge').addEventListener('touchstart', (e) => { e.preventDefault(); isCharging = true; });
        document.getElementById('btn-charge').addEventListener('touchend', (e) => { e.preventDefault(); isCharging = false; });

        function triggerJump() {
            if (isGrounded) {
                playerVelY = 0.35;
                isGrounded = false;
            }
        }

        // --- GAME LOOP ---
        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            if (!gameOver && Date.now() - lastTick >= 1000) {
                lastTick = Date.now();
                matchTime--;
                const timerEl = document.getElementById("time-left");
                if (timerEl) timerEl.innerText = matchTime;

                if (matchTime <= 0) {
                    gameOver = true;
                    setTimeout(() => {
                        alert("🏆 MATCH OVER!\n\nWinner: GreenDino\nGems Collected: " + score);
                    }, 100);
                }
            }

            if (gameOver) {
                if (!gameOver) {
                const now = Date.now();
                if (now - lastTick >= 1000) {
                    matchTime--;
                    lastTick = now;
                    document.getElementById("timer").innerText = matchTime;
                    if (matchTime <= 0) {
                        gameOver = true;
                        alert("🏆 Round Over!\n\nScore: " + score + " gems");
                    }
                }
            }

            renderer.render(scene, camera);
                return;
            }


            // 1. Gather Keyboard Inputs if active
            if (!joystickActive) {
                moveInput.x = 0;
                moveInput.y = 0;
                if (keys.a || keys.ArrowLeft) moveInput.x = -1;
                if (keys.d || keys.ArrowRight) moveInput.x = 1;
                if (keys.w || keys.ArrowUp) moveInput.y = -1;
                if (keys.s || keys.ArrowDown) moveInput.y = 1;
            }

            // 2. Player Locomotion
            let currentSpeed = isCharging ? 0.35 : 0.18;
            
            if (moveInput.x !== 0 || moveInput.y !== 0) {
                // Calculate movement vector relative to screen camera space
                const moveVec = new THREE.Vector3(moveInput.x, 0, moveInput.y).normalize();
                player.position.x += moveVec.x * currentSpeed;
                player.position.z += moveVec.z * currentSpeed;

                // Rotate player to face target direction smoothly
                const targetRotation = Math.atan2(-moveVec.x, -moveVec.z);
                player.rotation.y = targetRotation;

                // Animate wings while moving/running
                player.userData.wingL.rotation.z = 0.3 + Math.sin(time * 15) * 0.2;
                player.userData.wingR.rotation.z = -0.3 - Math.sin(time * 15) * 0.2;
            } else {
                // Idle wing breathing
                player.userData.wingL.rotation.z = 0.3 + Math.sin(time * 2) * 0.05;
                player.userData.wingR.rotation.z = -0.3 - Math.sin(time * 2) * 0.05;
            }

            // 3. Jump & Gravity Simulation
            player.position.y += playerVelY;
            if (!isGrounded) {
                playerVelY += gravity;
                // Double check if player hit the island height boundaries
                if (player.position.y <= 2.0) {
                    player.position.y = 2.0;
                    playerVelY = 0;
                    isGrounded = true;
                }
                // Fall off the world edge reset loop
                if (player.position.y < -30) {
                    player.position.set(0, 10, 0);
                    playerVelY = 0;
                }
            }

            // 4. Smooth Camera Following Dynamics
            const camTargetX = player.position.x;
            const camTargetY = player.position.y + 12;
            const camTargetZ = player.position.z + 22;
            camera.position.x += (camTargetX - camera.position.x) * 0.1;
            camera.position.y += (camTargetY - camera.position.y) * 0.1;
            camera.position.z += (camTargetZ - camera.position.z) * 0.1;
            camera.lookAt(player.position.x, player.position.y + 1, player.position.z);

            // 5. Simulate Other Network Players Behavior (Bots)
            netPlayers.forEach((p, idx) => {
                p.angle += p.speed;
                const newX = p.pivotX + Math.cos(p.angle) * p.radius;
                const newZ = p.pivotZ + Math.sin(p.angle) * p.radius;
                
                // Track facing direction
                const nextX = p.pivotX + Math.cos(p.angle + p.speed) * p.radius;
                const nextZ = p.pivotZ + Math.sin(p.angle + p.speed) * p.radius;
                p.mesh.rotation.y = Math.atan2(-(nextX - newX), -(nextZ - newZ));
                
                p.mesh.position.set(newX, 2.0 + Math.abs(Math.sin(time * 5 + idx)) * 0.2, newZ);
                p.mesh.userData.wingL.rotation.z = 0.3 + Math.sin(time * 12) * 0.2;
                p.mesh.userData.wingR.rotation.z = -0.3 - Math.sin(time * 12) * 0.2;
            });

            // 6. Gem Collection & Floating Animation
            gems.forEach((gem, idx) => {
                gem.rotation.y += 0.02;
                gem.position.y = 2.5 + Math.sin(time * 3 + idx) * 0.15;

                // Collison checks
                const dist = player.position.distanceTo(gem.position);
                if (dist < 1.8) {
                    // Collect Gem! teleporting it away to simulate gathering
                    gem.position.set((Math.random() - 0.5) * 50, -500, (Math.random() - 0.5) * 50); 
                    score += 1;
                    document.getElementById('gem-count').innerText = score;
                }
            });

            renderer.render(scene, camera);
        }

        // --- RESPONSIEVNESS HANDLING ---
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Trigger loop initialization
        animate();
    