import { useEffect, useRef, useState } from "react";

function recognitionCtor(): SpeechRecognitionConstructor | undefined {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

export function useSpeechToText(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    setSupported(Boolean(recognitionCtor()));
    return () => {
      recRef.current?.abort();
      recRef.current = null;
    };
  }, []);

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final.trim()) onFinalRef.current(final.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  function toggle() {
    if (listening) stop();
    else start();
  }

  return { listening, supported, toggle, stop };
}
