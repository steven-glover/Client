// src/components/VoiceChat.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import LanguageToggle from './LanguageToggle';
import '../styles/VoiceChat.css';

const LANG_LABELS = { en: 'English', ja: '日本語' };
const LANG_CODES   = { en: 'en-US',  ja: 'ja-JP' };

function VoiceChat() {
  /* ─── UI state ────────────────────────────── */
  const [isListening, setIsListening] = useState(false);
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState('');
  const [aiResponse, setAiResponse] = useState('');

  /* ─── Settings ────────────────────────────── */
  const [speakLang, setSpeakLang] = useState('en');
  const [hearLang,  setHearLang]  = useState('en');

  /* ─── refs ────────────────────────────────── */
  const recognitionRef = useRef(null);
  const abortRef       = useRef(null);

  /* ─── Helpers ─────────────────────────────── */
  const getErrorMessage = useCallback(type => {
    switch (type) {
      case 'speech':        return 'Speech recognition error. Please try again.';
      case 'not-supported': return 'Speech recognition is not supported in this browser.';
      default:              return 'Something went wrong. Please try again.';
    }
  }, []);

  /* ─── Mic animation toggle ────────────────── */
  const micClass = isListening ? 'vc-mic--active' : '';

  /* ─── Main speak handler ──────────────────── */
  const handleSpeak = useCallback(() => {
    /* basic capability check */
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError(getErrorMessage('not-supported'));
      return;
    }
    setError('');
    setAiResponse('');

    /* lazily create only once */
    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.interimResults = false;
    }
    const rec = recognitionRef.current;
    rec.lang  = LANG_CODES[speakLang];

    rec.onstart = () => setIsListening(true);
    rec.onerror = () => {
      setIsListening(false);
      setError(getErrorMessage('speech'));
    };
    rec.onend   = () => setIsListening(false);

    rec.onresult = async ({ results }) => {
      const userText = results[0][0].transcript.trim();
      setIsListening(false);
      setIsLoading(true);

      /* Cancel any previous pending fetch */
      abortRef.current?.abort?.();
      abortRef.current = new AbortController();

      try {
        const res = await fetch(
          `https://${process.env.REACT_APP_BACKEND_API_URL}/api/llm/ask-with-tts`,
          {
            signal: abortRef.current.signal,
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ prompt: userText, hearLang })
          }
        );

        if (!res.ok) throw new Error(await res.text());

        const { text, audioContent } = await res.json();
        setAiResponse(text);

        /* play audio */
        new Audio(`data:audio/wav;base64,${audioContent}`).play().catch(console.error);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(getErrorMessage());
          console.error(err);
        }
      } finally {
        setIsLoading(false);
      }
    };
    rec.start();
  }, [speakLang, hearLang, getErrorMessage]);

  /* ─── cleanup on unmount ───────────────────── */
  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    abortRef.current?.abort?.();
  }, []);

  /* ─── Render ──────────────────────────────── */
  return (
    <section className="vc container" aria-labelledby="vc-title">
      <h2 id="vc-title" className="vc__heading">LLM Voice Chat</h2>

      <div className="vc-settings">
        <LanguageToggle
          idPrefix="vc-speak"
          label="Speak"
          value={speakLang}
          onChange={setSpeakLang}
        />
        <LanguageToggle
          idPrefix="vc-hear"
          label="Hear"
          value={hearLang}
          onChange={setHearLang}
        />
      </div>

      <button
        type="button"
        className={`vc-mic ${micClass}`}
        onClick={handleSpeak}
        disabled={isListening || isLoading}
        aria-pressed={isListening}
        aria-label={isListening ? 'Stop listening' : 'Speak to AI'}
      >
        {isListening ? 'Listening…' : '🎤 Speak to AI'}
      </button>

      {isLoading && (
        <div className="vc-spinner" role="status" aria-live="polite">
          <div className="vc-spinner__dot"></div>
          <p>Processing…</p>
        </div>
      )}

      {error && <p className="vc-error" role="alert">{error}</p>}

      {aiResponse && (
        <article className="vc-response" aria-live="polite">
          <h3 className="vc-response__title">AI Response</h3>
          <p className="vc-response__text">{aiResponse}</p>
        </article>
      )}
    </section>
  );
}

export default VoiceChat;
