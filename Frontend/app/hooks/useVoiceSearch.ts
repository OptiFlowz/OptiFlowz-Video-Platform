import { useCallback, useEffect, useRef, useState } from "react";

// Speech recognition is still prefixed in some browsers and absent from lib.dom.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useVoiceSearch(locale: string, onTranscript: (text: string) => void) {
  const recognitionRef = useRef<Recognition | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");

  const dispose = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    recognition.abort();
  }, []);

  const cancel = useCallback(() => {
    dispose();
    setActive(false);
    setMessage("");
  }, [dispose]);

  useEffect(() => {
    cancel();
    const onHidden = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      dispose();
    };
  }, [locale, cancel, dispose]);

  const toggle = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const browser = window as SpeechWindow;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor || !window.isSecureContext) {
      setMessage("voiceSearchUnavailable");
      return;
    }
    let receivedText = false;
    let failed = false;
    try {
      const recognition = new Constructor();
      recognitionRef.current = recognition;
      // Match the selected interface language; preserve the browser's regional variant.
      recognition.lang = navigator.language.split("-")[0] === locale ? navigator.language : locale;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => setMessage("voiceSearchListening");
      recognition.onresult = event => {
        const text = Array.from(event.results, result => result[0]?.transcript ?? "").join(" ").trim();
        if (text) { receivedText = true; onTranscript(text); }
      };
      recognition.onerror = event => {
        failed = true;
        setActive(false);
        setMessage(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "voiceSearchPermission"
          : event.error === "no-speech" ? "voiceSearchNoSpeech"
          : event.error === "audio-capture" ? "voiceSearchNoMicrophone"
          : event.error === "language-not-supported" ? "voiceSearchLanguage"
          : "voiceSearchError");
        dispose();
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        setActive(false);
        if (!failed) setMessage(receivedText ? "voiceSearchReady" : "voiceSearchNoSpeech");
      };
      setActive(true);
      setMessage("voiceSearchStarting");
      recognition.start();
      // Never leave a forgotten recognition session listening indefinitely.
      timeoutRef.current = setTimeout(() => {
        dispose();
        setActive(false);
        setMessage(receivedText ? "voiceSearchReady" : "voiceSearchNoSpeech");
      }, 30000);
    } catch {
      dispose();
      setActive(false);
      setMessage("voiceSearchError");
    }
  };

  return { active, message, toggle, cancel };
}
