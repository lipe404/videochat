import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  onChildRemoved,
  onValue,
  push,
  remove,
  get,
  serverTimestamp,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDPngTQ8R3p2dO9GUFQm0MjyXjXx_4ooIg",
  authDomain: "webrole-2b66a.firebaseapp.com",
  databaseURL: "https://webrole-2b66a-default-rtdb.firebaseio.com",
  projectId: "webrole-2b66a",
  storageBucket: "webrole-2b66a.firebasestorage.app",
  messagingSenderId: "367941394512",
  appId: "1:367941394512:web:854ae35467967803e6f155",
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Variáveis globais
let localStream;
let currentRoomId;
let myPeerId;
const peers = {};
const videoGrid = document.getElementById("video-grid");
const MAX_PARTICIPANTS = 4;

// Configurações ICE
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

// Gera ID único para o usuário
function generatePeerId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Obtém ID da sala da URL ou gera uma nova
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get("room");

  if (!roomId) {
    roomId = generatePeerId();
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, "", newUrl);
  }

  return roomId;
}

// Verifica se a sala está cheia
async function checkRoomCapacity(roomId) {
  const peersRef = ref(database, `rooms/${roomId}/peers`);
  const snapshot = await get(peersRef);

  if (snapshot.exists()) {
    const peers = snapshot.val();
    const activePeers = Object.values(peers).filter((peer) => peer.active);
    return activePeers.length >= MAX_PARTICIPANTS;
  }

  return false;
}

// Função principal para entrar na sala
document.getElementById("join-room").addEventListener("click", async () => {
  const joinButton = document.getElementById("join-room");
  joinButton.disabled = true;
  joinButton.textContent = "Conectando...";

  try {
    currentRoomId = getRoomId();

    // Verifica se a sala está cheia
    const roomFull = await checkRoomCapacity(currentRoomId);
    if (roomFull) {
      alert(`Sala lotada! Máximo de ${MAX_PARTICIPANTS} participantes.`);
      return;
    }

    // Captura mídia do usuário
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true,
    });

    // Configurações iniciais
    myPeerId = generatePeerId();

    console.log("🎯 Meu ID:", myPeerId);
    console.log("🏠 Sala:", currentRoomId);

    // Adiciona vídeo local
    addVideoStream(createVideoElement(true), localStream, myPeerId, true);

    // Configura controles
    setupMediaControls(localStream);

    // Entra na sala
    await joinRoom(currentRoomId);

    // Atualiza interface
    updateUI(true);

    console.log("✅ Conectado com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao entrar na sala:", error);
    alert("Erro ao acessar câmera/microfone. Verifique as permissões.");
  } finally {
    joinButton.disabled = false;
    joinButton.textContent = "Entrar na Sala";
  }
});

// Função para entrar na sala
async function joinRoom(roomId) {
  const peersRef = ref(database, `rooms/${roomId}/peers`);
  const myPeerRef = ref(database, `rooms/${roomId}/peers/${myPeerId}`);

  // Registra presença na sala
  await set(myPeerRef, {
    timestamp: serverTimestamp(),
    active: true,
    joinedAt: Date.now(),
  });

  // Configura remoção automática ao desconectar
  onDisconnect(myPeerRef).remove();

  // Primeiro, verifica peers já existentes na sala
  const existingPeersSnapshot = await get(peersRef);
  if (existingPeersSnapshot.exists()) {
    const existingPeers = existingPeersSnapshot.val();

    for (const peerId in existingPeers) {
      if (peerId !== myPeerId && existingPeers[peerId].active) {
        console.log("🔗 Conectando com peer existente:", peerId);
        await createPeerConnection(peerId, true); // Sou o iniciador
      }
    }
  }

  // Escuta novos peers que entrarem depois de mim
  onChildAdded(peersRef, async (snapshot) => {
    const peerId = snapshot.key;
    const peerData = snapshot.val();

    if (peerId !== myPeerId && peerData.active && !peers[peerId]) {
      // Verifica se o peer entrou depois de mim
      const myData = await get(myPeerRef);
      if (myData.exists() && peerData.joinedAt > myData.val().joinedAt) {
        console.log("🆕 Novo peer detectado (depois de mim):", peerId);
        // Não inicio conexão, espero ele me conectar
      }
    }
  });

  // Escuta peers que saíram
  onChildRemoved(peersRef, (snapshot) => {
    const peerId = snapshot.key;
    if (peers[peerId]) {
      console.log("👋 Peer saiu:", peerId);
      peers[peerId].close();
      delete peers[peerId];
      removeVideoStream(peerId);
    }
  });

  // Sistema de sinalização
  setupSignaling(roomId);

  // Limpa ao sair
  window.addEventListener("beforeunload", () => {
    cleanup();
  });
}

// Configura sistema de sinalização
function setupSignaling(roomId) {
  // Escuta ofertas
  onChildAdded(ref(database, `rooms/${roomId}/offers`), async (snapshot) => {
    const data = snapshot.val();
    const { from, to, offer, timestamp } = data;

    if (to === myPeerId && !peers[from]) {
      console.log("📨 Recebendo oferta de:", from);
      await handleOffer(from, offer);
      // Remove a oferta após processar
      remove(snapshot.ref);
    }
  });

  // Escuta respostas
  onChildAdded(ref(database, `rooms/${roomId}/answers`), async (snapshot) => {
    const data = snapshot.val();
    const { from, to, answer } = data;

    if (to === myPeerId && peers[from]) {
      console.log("📨 Recebendo resposta de:", from);
      await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
      // Remove a resposta após processar
      remove(snapshot.ref);
    }
  });

  // Escuta candidatos ICE
  onChildAdded(
    ref(database, `rooms/${roomId}/ice-candidates`),
    async (snapshot) => {
      const data = snapshot.val();
      const { from, to, candidate } = data;

      if (to === myPeerId && peers[from]) {
        try {
          await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
          console.log("🧊 Candidato ICE adicionado de:", from);
        } catch (error) {
          console.warn("⚠️ Erro ao adicionar candidato ICE:", error);
        }
        // Remove o candidato após processar
        remove(snapshot.ref);
      }
    }
  );
}

// Cria conexão peer-to-peer
async function createPeerConnection(peerId, isInitiator = false) {
  if (peers[peerId]) {
    console.log("⚠️ Conexão já existe com:", peerId);
    return;
  }

  console.log(
    `🔗 Criando conexão P2P com ${peerId} (iniciador: ${isInitiator})`
  );

  const peerConnection = new RTCPeerConnection({ iceServers });
  peers[peerId] = peerConnection;

  // Adiciona tracks locais
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
    console.log("📤 Track adicionado:", track.kind);
  });

  // Recebe stream remoto
  peerConnection.ontrack = (event) => {
    console.log("📥 Stream remoto recebido de:", peerId);
    const remoteStream = event.streams[0];
    addVideoStream(createVideoElement(false), remoteStream, peerId, false);
  };

  // Monitora estado da conexão
  peerConnection.onconnectionstatechange = () => {
    console.log(
      `🔄 Estado da conexão com ${peerId}:`,
      peerConnection.connectionState
    );

    if (peerConnection.connectionState === "failed") {
      console.log("❌ Conexão falhou, tentando reconectar...");
      // Aqui você pode implementar lógica de reconexão
    }
  };

  // Envia candidatos ICE
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("🧊 Enviando candidato ICE para:", peerId);
      push(ref(database, `rooms/${currentRoomId}/ice-candidates`), {
        from: myPeerId,
        to: peerId,
        candidate: event.candidate.toJSON(),
        timestamp: Date.now(),
      });
    }
  };

  // Se for iniciador, cria oferta
  if (isInitiator) {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      console.log("📤 Enviando oferta para:", peerId);
      push(ref(database, `rooms/${currentRoomId}/offers`), {
        from: myPeerId,
        to: peerId,
        offer: offer,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Erro ao criar oferta:", error);
    }
  }
}

// Manipula ofertas recebidas
async function handleOffer(fromPeerId, offer) {
  console.log("🎯 Processando oferta de:", fromPeerId);

  try {
    const peerConnection = new RTCPeerConnection({ iceServers });
    peers[fromPeerId] = peerConnection;

    // Adiciona tracks locais
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // Recebe stream remoto
    peerConnection.ontrack = (event) => {
      console.log("📥 Stream remoto recebido de:", fromPeerId);
      const remoteStream = event.streams[0];
      addVideoStream(
        createVideoElement(false),
        remoteStream,
        fromPeerId,
        false
      );
    };

    // Monitora estado da conexão
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `🔄 Estado da conexão com ${fromPeerId}:`,
        peerConnection.connectionState
      );
    };

    // Envia candidatos ICE
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("🧊 Enviando candidato ICE para:", fromPeerId);
        push(ref(database, `rooms/${currentRoomId}/ice-candidates`), {
          from: myPeerId,
          to: fromPeerId,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now(),
        });
      }
    };

    // Configura oferta e cria resposta
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    console.log("📤 Enviando resposta para:", fromPeerId);
    push(ref(database, `rooms/${currentRoomId}/answers`), {
      from: myPeerId,
      to: fromPeerId,
      answer: answer,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Erro ao processar oferta:", error);
  }
}

// Cria elemento de vídeo
function createVideoElement(isLocal) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
  if (isLocal) video.muted = true;
  return video;
}

// Adiciona stream de vídeo à interface
function addVideoStream(video, stream, peerId, isLocal) {
  // Verifica se já existe
  if (document.getElementById(`video-${peerId}`)) {
    console.log("⚠️ Vídeo já existe para:", peerId);
    return;
  }

  video.srcObject = stream;

  const videoContainer = document.createElement("div");
  videoContainer.classList.add("video-container");
  videoContainer.id = `video-${peerId}`;

  // Adiciona label
  const label = document.createElement("div");
  label.classList.add("video-label");
  label.textContent = isLocal ? "Você" : `Usuário ${peerId.substr(0, 6)}`;

  // Adiciona indicador de status
  const statusIndicator = document.createElement("div");
  statusIndicator.classList.add("status-indicator");
  statusIndicator.classList.add(isLocal ? "local" : "remote");

  videoContainer.appendChild(video);
  videoContainer.appendChild(label);
  videoContainer.appendChild(statusIndicator);
  videoGrid.appendChild(videoContainer);

  console.log("📺 Vídeo adicionado para:", peerId);
}

// Remove stream de vídeo
function removeVideoStream(peerId) {
  const videoContainer = document.getElementById(`video-${peerId}`);
  if (videoContainer) {
    videoContainer.remove();
    console.log("🗑️ Vídeo removido para:", peerId);
  }
}

// Configura controles de mídia
function setupMediaControls(stream) {
  const muteAudioButton = document.getElementById("mute-audio");
  const toggleVideoButton = document.getElementById("toggle-video");

  muteAudioButton.addEventListener("click", () => {
    const audioTracks = stream.getAudioTracks();
    const isEnabled = audioTracks[0]?.enabled;
    audioTracks.forEach((track) => (track.enabled = !isEnabled));
    muteAudioButton.textContent = isEnabled ? "Desmutar Áudio" : "Mutar Áudio";
    muteAudioButton.classList.toggle("muted", !isEnabled);
  });

  toggleVideoButton.addEventListener("click", () => {
    const videoTracks = stream.getVideoTracks();
    const isEnabled = videoTracks[0]?.enabled;
    videoTracks.forEach((track) => (track.enabled = !isEnabled));
    toggleVideoButton.textContent = isEnabled
      ? "Ligar Câmera"
      : "Desligar Câmera";
    toggleVideoButton.classList.toggle("disabled", !isEnabled);
  });
}

// Atualiza interface
function updateUI(inRoom) {
  const joinButton = document.getElementById("join-room");
  const controls = document.getElementById("controls");

  if (inRoom) {
    joinButton.style.display = "none";

    // Adiciona contador de participantes
    const participantCounter = document.createElement("div");
    participantCounter.id = "participant-counter";
    participantCounter.textContent = `Participantes: 1/${MAX_PARTICIPANTS}`;
    controls.appendChild(participantCounter);

    // Atualiza contador quando peers mudam
    const updateCounter = () => {
      const activeConnections = Object.keys(peers).length + 1; // +1 para incluir você
      participantCounter.textContent = `Participantes: ${activeConnections}/${MAX_PARTICIPANTS}`;
    };

    // Monitora mudanças nos peers
    setInterval(updateCounter, 1000);

    // Adiciona botão para copiar link
    const copyLinkButton = document.createElement("button");
    copyLinkButton.textContent = "Copiar Link da Sala";
    copyLinkButton.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href);
      copyLinkButton.textContent = "Link Copiado!";
      setTimeout(() => {
        copyLinkButton.textContent = "Copiar Link da Sala";
      }, 2000);
    });
    controls.appendChild(copyLinkButton);

    // Adiciona botão para sair
    const leaveButton = document.createElement("button");
    leaveButton.textContent = "Sair da Sala";
    leaveButton.style.background = "linear-gradient(135deg, #ff4444, #cc0000)";
    leaveButton.addEventListener("click", () => {
      if (confirm("Tem certeza que deseja sair da sala?")) {
        cleanup();
        location.reload();
      }
    });
    controls.appendChild(leaveButton);
  }
}

// Função de limpeza
function cleanup() {
  console.log("🧹 Limpando recursos...");

  // Fecha todas as conexões peer
  for (const peerId in peers) {
    peers[peerId].close();
  }

  // Para todas as tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  // Remove do Firebase
  if (currentRoomId && myPeerId) {
    remove(ref(database, `rooms/${currentRoomId}/peers/${myPeerId}`));
  }
}
