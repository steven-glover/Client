import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import LanguageToggle from './LanguageToggle';
import '../styles/WebRTCChat.css';

/* 
  ─────────────────────────────────────────────────────────
   Main WebRTCChat Component
  ─────────────────────────────────────────────────────────
*/
function WebRTCChat() {
  /* ─── Identity & peer states ─── */
  const [myId, setMyId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [myName, setMyName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);

  /* ─── UI & call states ─── */
  const [incomingCall, setIncomingCall] = useState(null); // {from, name}
  const [error, setError] = useState('');
  const [isListening, setIsListening] = useState(false);

  /* ─── Language states ─── */
  const [speakLang, setSpeakLang] = useState('en');
  const [hearLang, setHearLang]   = useState('en');

  /* ─── Logs / transcripts ─── */
  const [speakerLog, setSpeakerLog] = useState([]);

  /* ─── WebRTC refs ─── */
  const socketRef        = useRef(null);
  const localStreamRef   = useRef(null);
  const peerConnsRef     = useRef({}); // { peerId: RTCPeerConnection }
  const remoteAudiosRef  = useRef({}); // { peerId: HTMLAudioElement }

  /* 
    ─────────────────────────────────────────────────
     Socket.IO setup: runs once when component mounts
    ─────────────────────────────────────────────────
  */
  useEffect(() => {
    // Connect to the Socket.IO backend
    socketRef.current = io(`wss://${process.env.REACT_APP_BACKEND_API_URL}`, {
      transports: ['websocket', 'polling'],
    });

    // Identify self
    socketRef.current.on('connect', () => {
      setMyId(socketRef.current.id);
    });

    // Update peer list
    socketRef.current.on('peer-list', (peerList) => {
      setPeers(peerList);
    });

    // Inbound call requests
    socketRef.current.on('call-request', ({ from, fromName }) => {
      setIncomingCall({ from, name: fromName });
    });

    socketRef.current.on('call-accepted', ({ from }) => {
      createAndSendOffer(from);
    });

    socketRef.current.on('call-rejected', ({ from }) => {
      alert(`Call rejected by ${from}`);
    });

    // Inbound WebRTC signals (offer/answer/ICE)
    socketRef.current.on('offer', ({ from, sdp }) => {
      handleOffer(from, sdp);
    });
    socketRef.current.on('answer', ({ from, sdp }) => {
      handleAnswer(from, sdp);
    });
    socketRef.current.on('ice_candidate', ({ from, candidate }) => {
      const pc = peerConnsRef.current[from];
      if (pc) {
        pc.addIceCandidate(candidate).catch(console.error);
      }
    });

    // Request mic access
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStreamRef.current = stream;
      })
      .catch(() => {
        setError('Microphone permission denied');
      });

    // Cleanup on component unmount
    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  /* 
    ───────────────────────────────────────────────────
     Handle inbound text from peers (for TTS / logging)
    ───────────────────────────────────────────────────
  */
  useEffect(() => {
    const handlePeerText = async ({ from, text, name }) => {
      // Convert text to speech & push to speaker log
      const utteredText = await textToSpeech(text);
      setSpeakerLog((log) => [`${name}: ${utteredText}`, ...log].slice(0, 25));
    };

    socketRef.current.on('peer-text', handlePeerText);
    return () => {
      socketRef.current.off('peer-text', handlePeerText);
    };
  }, [hearLang]);

  /* ─────────────────────────────────────────────────────────────
     1) Join flow
  ───────────────────────────────────────────────────────────── */
  const handleJoin = useCallback(() => {
    if (!myName.trim()) {
      alert('Please enter a valid name.');
      return;
    }
    socketRef.current.emit('join', { name: myName });
    setHasJoined(true);
  }, [myName]);

  /* ─────────────────────────────────────────────────────────────
     2) Call, Accept, Reject
  ───────────────────────────────────────────────────────────── */
  const callPeer = (peerId) => {
    socketRef.current.emit('call-request', { to: peerId, fromName: myName });
  };

  const acceptCall = useCallback(() => {
    socketRef.current.emit('call-accept', { to: incomingCall.from });
    setIncomingCall(null);
  }, [incomingCall]);

  const rejectCall = useCallback(() => {
    socketRef.current.emit('call-reject', { to: incomingCall.from });
    setIncomingCall(null);
  }, [incomingCall]);

  /* ─────────────────────────────────────────────────────────────
     3) WebRTC PeerConnection helpers
  ───────────────────────────────────────────────────────────── */
  async function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // On ICE candidates -> send to remote peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice_candidate', {
          to: peerId,
          candidate: event.candidate,
        });
      }
    };

    // When we get remote track -> attach to an <audio> element
    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      if (!remoteAudiosRef.current[peerId]) {
        const audioEl = new Audio();
        audioEl.srcObject = remoteStream;
        audioEl.autoplay = true;
        audioEl.onended = () => {
          delete remoteAudiosRef.current[peerId];
        };
        remoteAudiosRef.current[peerId] = audioEl;
      }
    };

    // Add our microphone track(s)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) =>
        pc.addTrack(track, localStreamRef.current)
      );
    }

    // Store connection reference
    peerConnsRef.current[peerId] = pc;
    return pc;
  }

  // Caller creates offer
  async function createAndSendOffer(peerId) {
    const pc =
      peerConnsRef.current[peerId] || (await createPeerConnection(peerId));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current.emit('offer', {
      to: peerId,
      sdp: pc.localDescription,
    });
  }

  // Callee handles inbound offer
  async function handleOffer(from, sdp) {
    const pc =
      peerConnsRef.current[from] || (await createPeerConnection(from));
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    // Respond with answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current.emit('answer', {
      to: from,
      sdp: pc.localDescription,
    });
  }

  // Caller handles inbound answer
  async function handleAnswer(from, sdp) {
    const pc = peerConnsRef.current[from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  /* ─────────────────────────────────────────────────────────────
     4) Speech Recognition & sending text to peers
  ───────────────────────────────────────────────────────────── */
  const handleSpeak = useCallback(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      setError('Your browser does not support Speech Recognition.');
      return;
    }
    setError('');

    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Rec();
    recognition.lang = speakLang === 'en' ? 'en-US' : 'ja-JP';

    recognition.onresult = ({ results }) => {
      const text = results[0][0].transcript;
      socketRef.current.emit('peer-text', { text, name: myName });
    };

    recognition.onerror = () => {
      setError('Speech recognition error. Please try again.');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    setIsListening(true);
    recognition.start();
  }, [myName, speakLang]);

  /* ─────────────────────────────────────────────────────────────
     5) TTS helper function
     - You can replace this with your actual TTS API or remove it.
  ───────────────────────────────────────────────────────────── */
  async function textToSpeech(text) {
    if (!text) return '';
    try {
      const res = await fetch(
        `https://${process.env.REACT_APP_BACKEND_API_URL}/api/translate/text-to-speech`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, hearLang }),
        }
      );
      if (res.ok) {
        const { audioContent, translatedText } = await res.json();
        const audio = new Audio(`data:audio/wav;base64,${audioContent}`);
        audio.play().catch(console.error);
        return translatedText;
      }
      // fallback if request fails
      return text;
    } catch (err) {
      console.error(err);
      return text;
    }
  }

  /* 
    ─────────────────────────────────────────────────────────────
     Conditional UI
    ───────────────────────────────────────────────────────────── 
  */
  // If user hasn't joined, show a "Join" form
  if (!hasJoined) {
    return (
      <JoinForm
        myName={myName}
        setMyName={setMyName}
        onJoin={handleJoin}
        error={error}
      />
    );
  }

  // Otherwise, show the main chat interface
  return (
    <div className="webrtc-chat-container">
      <header className="webrtc-chat-header">
        <h2>WebRTC Voice Chat</h2>
      </header>

      {error && <div className="webrtc-error">{error}</div>}

      {incomingCall && (
        <IncomingCallPrompt
          incomingCall={incomingCall}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      <div className="webrtc-main-content">
        <div className="webrtc-left-panel">
          <PeerList peers={peers} myId={myId} onCallPeer={callPeer} />
          <SpeechControls
            isListening={isListening}
            speakLang={speakLang}
            setSpeakLang={setSpeakLang}
            hearLang={hearLang}
            setHearLang={setHearLang}
            onSpeak={handleSpeak}
          />
        </div>

        <div className="webrtc-right-panel">
          <SpeakerLog speakerLog={speakerLog} />
        </div>
      </div>
    </div>
  );
}


function JoinForm({ myName, setMyName, onJoin, error }) {
  return (
    <div className="name-entry-container">
      <h2>Enter Your Name</h2>
      {error && <div className="webrtc-error">{error}</div>}
      <input
        className="name-input"
        value={myName}
        onChange={(e) => setMyName(e.target.value)}
        placeholder="Your Name"
      />
      <button onClick={onJoin} className="btn btn-join">
        Join Chat
      </button>
    </div>
  );
}

/* Prompt shown when an incoming call arrives */
function IncomingCallPrompt({ incomingCall, onAccept, onReject }) {
  return (
    <div className="incoming-call">
      <p>
        <strong>Incoming call:</strong> {incomingCall.name || incomingCall.from}
      </p>
      <div className="incoming-call-buttons">
        <button onClick={onAccept} className="btn btn-accept">
          Accept
        </button>
        <button onClick={onReject} className="btn btn-reject">
          Reject
        </button>
      </div>
    </div>
  );
}

function PeerList({ peers, myId, onCallPeer }) {
  const filteredPeers = peers.filter((p) => p.id !== myId);

  return (
    <div className="peer-list-container">
      <h3>Peers</h3>
      <div className="peer-list">
        {filteredPeers.map((p) => (
          <div key={p.id} className="peer-row">
            <span className="peer-name">{p.name || p.id}</span>
            <button
              onClick={() => onCallPeer(p.id)}
              className="btn btn-call-peer"
            >
              Call
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}


function SpeechControls({
  isListening,
  speakLang,
  setSpeakLang,
  hearLang,
  setHearLang,
  onSpeak,
}) {
  return (
    <div className="speech-controls">
      <div className="rtc-langs">
        <LanguageToggle
          idPrefix="rtc-speak"
          label="Speak"
          value={speakLang}
          onChange={setSpeakLang}
        />
        <LanguageToggle
          idPrefix="rtc-hear"
          label="Hear"
          value={hearLang}
          onChange={setHearLang}
        />
      </div>

      <button
        disabled={isListening}
        onClick={onSpeak}
        className={`btn btn-speak ${isListening ? 'listening' : ''}`}
      >
        {isListening ? 'Listening...' : '🎤 Speak'}
      </button>
    </div>
  );
}

/* Shows the recent messages/speech logs */
function SpeakerLog({ speakerLog }) {
  return (
    <div className="speaker-log-container">
      <h3>Conversation</h3>
      <div className="speaker-log">
        {speakerLog.map((line, idx) => (
          <div key={idx} className="speaker-log-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export default WebRTCChat;
