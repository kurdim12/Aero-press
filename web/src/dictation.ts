// Voice input through the browser's speech recognition, where the phone has it
// (Chrome on Android, Safari on iPhone). Nothing is sent anywhere by the app itself.
import { useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Tap to talk, tap to stop; each finished phrase is handed to `onText`. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  const available = typeof window !== 'undefined' && recognitionCtor() !== null;

  useEffect(() => () => recognition.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (text) latest.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    rec.start();
    setListening(true);
  };

  return { available, listening, toggle };
}
