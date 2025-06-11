import React from 'react';
import WebRTCChat from './components/WebRTCChat';
import VoiceChat from './components/VoiceChat';
import './styles/App.css';

const socketUrl = process.env.BACKEND_API_URL;

function App() {
  return (
    <div className="app-container">
      <h1>Multi-Language Voice Chat</h1>
      <div className="chat-sections">
        <WebRTCChat />
        <VoiceChat />
      </div>
    </div>
  );
}

export default App;
