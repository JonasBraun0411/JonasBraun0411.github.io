document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    // TODO: Paste your Firebase Config object here from the Console
    // (Project Settings > General > Your apps > Web app > SDK setup and configuration)

    const firebaseConfig = {
    apiKey: "AIzaSyATCCMavTXqU0xf4C_1coM1wdjqQF7_GCI",
    authDomain: "pwa-voip.firebaseapp.com",
    projectId: "pwa-voip",
    storageBucket: "pwa-voip.firebasestorage.app",
    messagingSenderId: "420096020232",
    appId: "1:420096020232:web:5fcc0d6e8ff2394184a6bd"
    };

    // Initialize Firebase manually
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.firestore();
    let messaging;
    try {
        messaging = firebase.messaging();
    } catch (e) {
        console.log("Messaging not supported or failed to init (okay for dev/simulator if not supported)");
    }

    const authBtn = document.getElementById('auth-btn');
    const loginSection = document.getElementById('login-section');
    const mainContent = document.getElementById('main-content');
    const availabilityDisplay = document.getElementById('availability-display');
    const availabilityInput = document.getElementById('availability-time');
    const setAvailabilityBtn = document.getElementById('set-availability-btn'); // Moved here

    // --- In-app Debug Log (for iPhone PWA) ---
    const debugSection = document.getElementById('debug-section');
    const debugLogEl = document.getElementById('debug-log');
    const debugClearBtn = document.getElementById('debug-clear-btn');
    const debugToggleBtn = document.getElementById('debug-toggle-btn');

    function formatAny(value) {
        try {
            if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
            if (typeof value === 'string') return value;
            return JSON.stringify(value, null, 2);
        } catch (e) {
            return String(value);
        }
    }

    function appendDebugLine(level, parts) {
        if (!debugLogEl) return;
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
        const line = document.createElement('div');
        line.className = `debug-line debug-${level}`;
        line.textContent = `[${ts}] [${level}] ${parts.map(formatAny).join(' ')}`;
        debugLogEl.appendChild(line);
        debugLogEl.scrollTop = debugLogEl.scrollHeight;
    }

    // Patch console.* so logs show up in the UI
    const _log = console.log.bind(console);
    const _warn = console.warn.bind(console);
    const _error = console.error.bind(console);
    console.log = (...args) => { appendDebugLine('info', args); _log(...args); };
    console.warn = (...args) => { appendDebugLine('warn', args); _warn(...args); };
    console.error = (...args) => { appendDebugLine('error', args); _error(...args); };

    window.addEventListener('error', (evt) => {
        appendDebugLine('error', ['window.onerror', evt.message, evt.filename, `:${evt.lineno}:${evt.colno}`]);
    });
    window.addEventListener('unhandledrejection', (evt) => {
        appendDebugLine('error', ['unhandledrejection', evt.reason]);
    });

    if (debugClearBtn) {
        debugClearBtn.addEventListener('click', () => {
            if (debugLogEl) debugLogEl.textContent = '';
        });
    }
    if (debugToggleBtn) {
        debugToggleBtn.addEventListener('click', () => {
            if (!debugSection) return;
            debugSection.classList.toggle('debug-hidden');
            debugToggleBtn.textContent = debugSection.classList.contains('debug-hidden') ? 'Show' : 'Hide';
        });
    }

    console.log('Debug log initialized');
    
    // --- Listener Management ---
    let unsubscribes = [];

    // Auth State Listener
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // User is signed in
            console.log('User signed in:', user.uid);
            authBtn.textContent = 'Logout';
            authBtn.classList.remove('btn-primary');
            authBtn.classList.add('btn-secondary');
            
            loginSection.classList.add('hidden');
            mainContent.style.display = 'flex'; // Restore flex layout
            mainContent.classList.remove('hidden');
            
            // Save user profile
            await db.collection('users').doc(user.uid).set({
                name: user.email, // Use email as name for simple auth
                email: user.email,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            // Request Notification Permission
            setupNotifications(user.uid);
            
            // Load Availability
            loadAvailability(user.uid);
            
            // Listen for calls
            listenForCalls(user.uid);

        } else {
            // User is signed out
            console.log('User signed out');
            
            // Unsubscribe from all Firestore listeners
            unsubscribes.forEach(unsub => unsub());
            unsubscribes = [];
            
            authBtn.textContent = 'VoIP Proto'; // Reset text
            authBtn.classList.remove('btn-secondary');
            authBtn.classList.remove('btn-primary');
            
            loginSection.classList.remove('hidden');
            mainContent.style.display = 'none';
            mainContent.classList.add('hidden');
        }
    });

    // Auth Button Click (Logout only)
    authBtn.addEventListener('click', () => {
        if (auth.currentUser) {
            auth.signOut();
        }
    });

    // Email/Password Login Logic
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const emailLoginBtn = document.getElementById('email-login-btn');

    emailLoginBtn.addEventListener('click', () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        
        if (!email || !password) {
            alert('Please enter both email and password.');
            return;
        }

        auth.signInWithEmailAndPassword(email, password)
            .catch((error) => {
                console.error("Login failed:", error);
                alert("Login failed: " + error.message);
            });
    });

    async function setupNotifications(uid) {
        if (!messaging) return;
        try {
            const vapidKey = 'BKKrCfIl9v3peqep2D_SNMFxkz3adPJ-z3vGy5aKBllSTjUVg6Da4I_JhMgIRqJslln9fMUqlhyP-P348SMA1cc'; 

            // IMPORTANT:
            // If you don't pass a SW registration, Firebase Messaging will try the default:
            //   /firebase-messaging-sw.js
            // We register it ourselves relative to the current page, then pass the registration
            // so Firebase uses the correct path even when hosted under a subdirectory.
            let swReg;
            if ('serviceWorker' in navigator) {
                try {
                    const swUrl = new URL('firebase-messaging-sw.js', window.location.href);
                    swReg = await navigator.serviceWorker.register(swUrl.toString());
                    await navigator.serviceWorker.ready;
                    console.log('Messaging service worker registered:', swUrl.toString());
                } catch (e) {
                    console.log('Service worker registration failed:', e);
                }
            }

            const token = await messaging.getToken({
                vapidKey,
                ...(swReg ? { serviceWorkerRegistration: swReg } : {})
            });
            // Note: In newer Firebase versions, vapidKey is required for getToken. 
            // For prototype we'll assume it works or just logs.
            console.log('FCM Token:', token);
            if (token) {
                await db.collection('users').doc(uid).set({
                    fcmToken: token
                }, { merge: true });
            }
        } catch (error) {
            console.log('Notification permission/token error:', error);
        }
    }

    // --- Button Event Listeners ---
    const muteBtn = document.getElementById('mute-btn');
    const hangupBtn = document.getElementById('hangup-btn');
    let isMuted = false;

    muteBtn.addEventListener('click', () => {
        if (!localStream) return;
        const track = localStream.getAudioTracks()[0];
        isMuted = !isMuted;
        track.enabled = !isMuted;
        muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
    });

    hangupBtn.addEventListener('click', async () => {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        // Update DB status
        if (currentCallId) {
            await db.collection('calls').doc(currentCallId).update({ status: 'ended' });
            currentCallId = null;
        }

        // Reset UI
        document.getElementById('call-status').textContent = 'IDLE';
        document.getElementById('app').classList.remove('state-active');
        muteBtn.disabled = true;
        muteBtn.textContent = 'Mute';
        isMuted = false;
        hangupBtn.disabled = true;
        document.getElementById('remote-audio').srcObject = null;
        
        // Reload page or re-listen? For prototype, simple reset:
        alert("Call Ended");
    });
    
    setAvailabilityBtn.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) return;
        
        const timeVal = availabilityInput.value;
        if (!timeVal) return alert("Please pick a time");
        
        const date = new Date(timeVal);
        
        await db.collection('users').doc(user.uid).set({
            availability: firebase.firestore.Timestamp.fromDate(date)
        }, { merge: true });
        
        alert("Availability set!");
    });

    function loadAvailability(uid) {
        const unsub = db.collection('users').doc(uid).onSnapshot(doc => {
            const data = doc.data();
            if (data && data.availability) {
                const date = data.availability.toDate();
                availabilityDisplay.textContent = "Current availability: " + date.toLocaleString();
            }
        });
        unsubscribes.push(unsub);
    }
    
    // --- Call Logic (Step 6) ---
    let localStream;
    let peerConnection;
    let currentCallId;

    function listenForCalls(uid) {
        const unsubscribe1 = db.collection('calls')
            .where('caller_1', '==', uid)
            .where('status', 'in', ['available', 'connecting', 'active'])
            .onSnapshot(snapshot => handleCallSnapshot(snapshot, uid, 'caller_1'));
            
        const unsubscribe2 = db.collection('calls')
            .where('caller_2', '==', uid)
            .where('status', 'in', ['available', 'connecting', 'active'])
            .onSnapshot(snapshot => handleCallSnapshot(snapshot, uid, 'caller_2'));
            
        unsubscribes.push(unsubscribe1);
        unsubscribes.push(unsubscribe2);
    }

    async function handleCallSnapshot(snapshot, uid, myRole) {
        if (snapshot.empty) return;
        
        const doc = snapshot.docs[0]; // Handle one call at a time
        const data = doc.data();
        currentCallId = doc.id;
        
        console.log(`Call found! Role: ${myRole}, Status: ${data.status}`);
        
        // Update UI
        document.getElementById('call-status').textContent = data.status.toUpperCase();
        document.getElementById('app').classList.add('state-active');
        
        if (data.status === 'available') {
            // Start Signaling
             startCallSequence(doc.id, myRole, data);
        }
    }

    async function startCallSequence(callId, myRole, data) {
        // Only start if we haven't already
        if (peerConnection) return; 
        
        console.log("Starting call sequence...");
        
        // 1. Get User Media
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.error("Microphone error:", e);
            alert("Could not access microphone.");
            return;
        }

        // 2. Create PeerConnection
        const config = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" }
            ]
        };
        peerConnection = new RTCPeerConnection(config);
        
        // Add tracks
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Handle remote tracks
        peerConnection.ontrack = (event) => {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio.srcObject !== event.streams[0]) {
                remoteAudio.srcObject = event.streams[0];
                console.log("Remote stream received");
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const field = myRole === 'caller_1' ? 'ice_1' : 'ice_2';
                db.collection('calls').doc(callId).update({
                    [field]: firebase.firestore.FieldValue.arrayUnion(event.candidate.toJSON())
                });
            }
        };

        // 3. Signaling Logic (Alphabetical)
        if (myRole === 'caller_1') {
            // Create Offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            await db.collection('calls').doc(callId).update({
                offer: {
                    type: offer.type,
                    sdp: offer.sdp
                },
                status: 'connecting' // Move to connecting
            });
            
        } 
        // For caller_2, we do NOTHING here. We wait for the onSnapshot listener below
        // to detect the offer and respond. This prevents race conditions.
        
        // Update UI - Enable Call Controls
        document.getElementById('mute-btn').disabled = false;
        document.getElementById('hangup-btn').disabled = false;
        
        // Listen for remote ICE and Answer (if caller_1) OR Offer (if caller_2)
        db.collection('calls').doc(callId).onSnapshot(async (snapshot) => {
            const updatedData = snapshot.data();
            if (!peerConnection) return;

            // Handle Answer (for caller_1)
            if (myRole === 'caller_1' && updatedData.answer && !peerConnection.currentRemoteDescription) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(updatedData.answer));
            }
            // Handle Offer (for caller_2) - if it arrived late
            else if (myRole === 'caller_2' && updatedData.offer && !peerConnection.currentRemoteDescription) {
                 await peerConnection.setRemoteDescription(new RTCSessionDescription(updatedData.offer));
                 const answer = await peerConnection.createAnswer();
                 await peerConnection.setLocalDescription(answer);
                 
                 await db.collection('calls').doc(callId).update({
                     answer: { type: answer.type, sdp: answer.sdp },
                     status: 'connecting'
                 });
            }

            // Handle ICE Candidates
            const remoteIceField = myRole === 'caller_1' ? 'ice_2' : 'ice_1';
            const remoteCandidates = updatedData[remoteIceField];
            
            if (remoteCandidates) {
                for (const candidate of remoteCandidates) {
                     // IMPORTANT: Only add ICE if remote description is set
                     if (peerConnection.remoteDescription) {
                         try {
                             await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                         } catch (e) {
                             console.log("Error adding ice:", e);
                         }
                     } else {
                         // Optional: You could queue these, but typically we just wait for the next snapshot
                         // or rely on the fact that once setRemoteDescription happens, we process existing ones?
                         // Actually, simpler: just don't add them yet.
                         // But if we don't add them now, will we add them later? 
                         // Yes, this listener fires on every update.
                         // BUT: If the ICE array doesn't *change* later, this might not re-run for old candidates.
                         // BETTER: Queue them.
                         
                         // Simple Queue Implementation:
                         if (!window.iceQueue) window.iceQueue = [];
                         window.iceQueue.push(candidate);
                     }
                }
            }
            
            // Flush ICE Queue if description is now ready
            if (peerConnection.remoteDescription && window.iceQueue && window.iceQueue.length > 0) {
                 for (const candidate of window.iceQueue) {
                     try {
                         await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                     } catch(e) {}
                 }
                 window.iceQueue = [];
            }
            
            // Check connection state
            if (peerConnection.connectionState === 'connected') {
                 document.getElementById('call-status').textContent = "ACTIVE";
                 if (updatedData.status !== 'active') {
                     // Update status to active only once
                     db.collection('calls').doc(callId).update({ status: 'active' });
                 }
            }
        });
    }
});
