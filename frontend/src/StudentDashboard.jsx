
import { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Brain,
  FileText,
  Languages,
  ChevronDown,
  ArrowRight,
  Sparkles,
  GraduationCap,
  ClipboardList,
  NotebookPen,
  Menu,
  X,
  LogOut,
  Save,
  LoaderCircle,
  Mic,
  MicOff,
  Volume2,
  Square,
  RotateCcw,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "./supabase";
import "./StudentDashboard.css";

// Normalize quiz options into stable answer-key values (A/B/C/D), regardless of API shape.
function normalizeQuizOptions(options) {
  if (options && !Array.isArray(options) && typeof options === "object") {
    return Object.entries(options).map(([key, value], index) => ({
      key: /^[A-D]$/i.test(key) ? key.toUpperCase() : String.fromCharCode(65 + index),
      text: typeof value === "string" || typeof value === "number"
        ? String(value)
        : String(value?.text ?? value?.label ?? value?.option ?? value?.value ?? ""),
    })).filter((option) => option.text.trim());
  }

  let values = options;
  if (typeof options === "string") {
    const trimmed = options.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
        return normalizeQuizOptions(parsed);
      }
    } catch {
      // Treat non-JSON strings as newline/comma-separated choices.
    }
    values = trimmed.split(/\r?\n|\s*,\s*/).map((option) => option.trim()).filter(Boolean);
  }

  if (!Array.isArray(values)) return [];
  return values.map((value, index) => ({
    key: String.fromCharCode(65 + index),
    text: typeof value === "string" || typeof value === "number"
      ? String(value)
      : String(value?.text ?? value?.label ?? value?.option ?? value?.value ?? ""),
  })).filter((option) => option.text.trim());
}

const questionPlaceholders = {
  English: "Ask your question in English, or use the microphone to speak...",
  Hinglish: "Apna sawaal Hinglish mein type karo ya microphone se bolo...",
  Hindi: "हिंदी में अपना सवाल यहाँ लिखें या माइक से बोलें...",
  Tamil: "தமிழில் உங்கள் கேள்வியை இங்கே எழுதவும் அல்லது மைக்கைப் பயன்படுத்திப் பேசவும்...",
  Bengali: "বাংলায় আপনার প্রশ্ন এখানে লিখুন অথবা মাইক্রোফোনে বলুন...",
  Telugu: "తెలుగులో మీ ప్రశ్నను ఇక్కడ టైప్ చేయండి లేదా మైక్రోఫోన్‌లో మాట్లాడండి...",
  Kannada: "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕನ್ನಡದಲ್ಲಿ ಇಲ್ಲಿ ಬರೆಯಿರಿ ಅಥವಾ ಮೈಕ್ರೊಫೋನ್ ಬಳಸಿ ಮಾತನಾಡಿ...",
  Malayalam: "നിങ്ങളുടെ ചോദ്യം മലയാളത്തിൽ ഇവിടെ എഴുതുക അല്ലെങ്കിൽ മൈക്രോഫോൺ ഉപയോഗിച്ച് സംസാരിക്കുക...",
  Marathi: "तुमचा प्रश्न मराठीत येथे लिहा किंवा मायक्रोफोन वापरून बोला...",
  Gujarati: "તમારો પ્રશ્ન ગુજરાતીમાં અહીં લખો અથવા માઇક્રોફોનનો ઉપયોગ કરીને બોલો...",
  Punjabi: "ਆਪਣਾ ਸਵਾਲ ਪੰਜਾਬੀ ਵਿੱਚ ਇੱਥੇ ਲਿਖੋ ਜਾਂ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਨਾਲ ਬੋਲੋ...",
};

const languages = [
  { name: "English", code: "en-IN" },
  { name: "Hindi", code: "hi-IN" },
  { name: "Hinglish", code: "hi-IN" },
  { name: "Tamil", code: "ta-IN" },
  { name: "Bengali", code: "bn-IN" },
  { name: "Telugu", code: "te-IN" },
  { name: "Kannada", code: "kn-IN" },
  { name: "Malayalam", code: "ml-IN" },
  { name: "Marathi", code: "mr-IN" },
  { name: "Gujarati", code: "gu-IN" },
  { name: "Punjabi", code: "pa-IN" },
];

const activities = [
  {
    icon: Brain,
    title: "Ask an AI tutor",
    description: "Get a difficult concept explained in simple language.",
    action: "Ask a doubt",
    target: "doubt",
  },
  {
    icon: FileText,
    title: "Study materials",
    description: "Bring your textbooks, PDFs, and study notes.",
    action: "Explore materials",
    target: "materials",
  },
  {
    icon: ClipboardList,
    title: "Practice quiz",
    description: "Test your understanding with multiple-choice questions.",
    action: "Start practicing",
    target: "quiz",
  },
  {
    icon: NotebookPen,
    title: "Revision notes",
    description: "Keep important concepts ready for your next revision.",
    action: "View notes",
    target: "notes",
  },
];


// Convert browser-recorded audio (often WebM/Opus) into PCM WAV.
// Gnani's STT endpoint accepts WAV, while WebM is rejected by the API.
async function convertAudioBlobToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("This browser cannot convert the recording to WAV. Please try another browser.");
  }

  const audioContext = new AudioContextClass();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelCount = Math.min(decodedBuffer.numberOfChannels, 2);
    const frameCount = decodedBuffer.length;
    const sampleRate = decodedBuffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);

    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      channels.push(decodedBuffer.getChannelData(channel));
    }

    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        offset += bytesPerSample;
      }
    }

    return new Blob([wavBuffer], { type: "audio/wav" });
  } finally {
    await audioContext.close();
  }
}

const API_BASE_URL = "http://127.0.0.1:8000";

export default function StudentDashboard({ user, onLogout }) {
  const [studentName, setStudentName] = useState(
    user?.user_metadata?.full_name ||
      user?.email?.split("@")[0] ||
      ""
  );
  const [studentClass, setStudentClass] = useState("");
  const [language, setLanguage] = useState("English");

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  const [activeSection, setActiveSection] = useState("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [question, setQuestion] = useState("");
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [questionResult, setQuestionResult] = useState(null);

  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfBusy, setPdfBusy] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [pdfMessage, setPdfMessage] = useState("");
  const [pdfExtract, setPdfExtract] = useState(null);
  const [pdfSummary, setPdfSummary] = useState(null);
  const [quizCount, setQuizCount] = useState("5");
  const [quizDifficulty, setQuizDifficulty] = useState("Medium");
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizTopic, setQuizTopic] = useState("");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [quizHistory, setQuizHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bolobodhh_quiz_history") || "[]"); }
    catch { return []; }
  });
  const quizReviewTimeoutRef = useRef(null);
  const [quizError, setQuizError] = useState("");
  const [quizBusyForGenerate, setQuizBusyForGenerate] = useState(false);
  const [quizGrading, setQuizGrading] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bolobodhh_revision_notes") || "[]"); }
    catch { return []; }
  });
  const [revisionNoteTitle, setRevisionNoteTitle] = useState("");
  const [revisionNoteBody, setRevisionNoteBody] = useState("");
  const [revisionNoteMessage, setRevisionNoteMessage] = useState("");

  // Supabase is the durable source of truth; localStorage remains a fallback for offline use.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    async function loadLearningRecords() {
      try {
        const [notesResponse, historyResponse] = await Promise.all([
          supabase.from("revision_notes").select("id,title,body,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
          supabase.from("quiz_history").select("id,topic,questions,answers,result,completed_at").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(50),
        ]);
        if (notesResponse.error) throw notesResponse.error;
        if (historyResponse.error) throw historyResponse.error;
        if (cancelled) return;
        const notes = (notesResponse.data || []).map((n) => ({ id: String(n.id), title: n.title, body: n.body, createdAt: n.created_at }));
        const history = (historyResponse.data || []).map((q) => ({ id: String(q.id), topic: q.topic, questions: q.questions || [], answers: q.answers || {}, result: q.result || {}, completedAt: q.completed_at }));
        setRevisionNotes(notes);
        setQuizHistory(history);
        localStorage.setItem("bolobodhh_revision_notes", JSON.stringify(notes));
        localStorage.setItem("bolobodhh_quiz_history", JSON.stringify(history));
      } catch (error) {
        console.warn("Could not sync learning history from Supabase; browser cache will be used.", error.message || error);
      }
    }
    loadLearningRecords();
    return () => { cancelled = true; };
  }, [user?.id]);

  const audioRef = useRef(null);
  const audioObjectUrlRef = useRef(null);
  const recorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => () => {
    if (quizReviewTimeoutRef.current) window.clearTimeout(quizReviewTimeoutRef.current);
  }, []);

  const firstName = studentName.trim().split(/\s+/)[0] || "Student";
  const selectedLanguage =
    languages.find((item) => item.name === language) || languages[0];

  // Gnani performs transcription on the backend; the browser only records audio.
  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof window.MediaRecorder !== "undefined";

    setSpeechSupported(supported);

    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };
  }, []);

  // Load this authenticated student's profile from Supabase.
  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError("");
      setProfileMessage("");

      try {
        const { data, error } = await supabase
          .from("student_profiles")
          .select("full_name, grade, preferred_language")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;
        if (!active) return;

        if (data) {
          setStudentName(
            data.full_name ||
              user.user_metadata?.full_name ||
              user.email?.split("@")[0] ||
              ""
          );
          setStudentClass(data.grade || "");
          setLanguage(data.preferred_language || "English");
        }
      } catch (err) {
        if (active) {
          setProfileError(
            err.message || "Could not load your saved profile."
          );
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    }

    if (user?.id) {
      loadProfile();
    } else {
      setProfileLoading(false);
    }

    return () => {
      active = false;
    };
  }, [user?.id, user?.email, user?.user_metadata?.full_name]);

  // Save or update the authenticated student's profile.
  async function saveProfile(event) {
    event.preventDefault();
    setProfileMessage("");
    setProfileError("");

    if (!studentName.trim()) {
      setProfileError("Please enter your name.");
      return;
    }

    if (!studentClass) {
      setProfileError("Please choose your class or grade.");
      return;
    }

    if (!user?.id) {
      setProfileError("Your session has expired. Please sign in again.");
      return;
    }

    setProfileSaving(true);

    try {
      const { error } = await supabase
        .from("student_profiles")
        .upsert(
          {
            user_id: user.id,
            full_name: studentName.trim(),
            grade: studentClass,
            preferred_language: language,
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;

      setProfileMessage("Your learning preferences have been saved.");
    } catch (err) {
      setProfileError(
        err.message || "Could not save your profile. Please try again."
      );
    } finally {
      setProfileSaving(false);
    }
  }

  function navigateTo(section) {
    setActiveSection(section);
    setMobileMenuOpen(false);

    // The first four tools are one continuous learning page. Only Notes and
    // Quiz History are dedicated pages.
    if (["home", "doubt", "materials", "quiz"].includes(section)) {
      const targetIds = {
        home: "dashboard-home",
        doubt: "dashboard-doubt",
        materials: "dashboard-materials",
        quiz: "dashboard-quiz",
      };
      window.setTimeout(() => {
        const target = document.getElementById(targetIds[section]);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function stopListening() {
    const recorder = recorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function startListening() {
    if (isListening) {
      stopListening();
      return;
    }

    if (!speechSupported) {
      setSpeechMessage(
        "Audio recording is unavailable in this browser. You can type your question instead."
      );
      return;
    }

    if (!studentClass) {
      setQuestionError("Choose your class in learning preferences first.");
      return;
    }

    setQuestionError("");
    setSpeechMessage("");
    setQuestionResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      const mimeType = mimeCandidates.find((type) =>
        window.MediaRecorder.isTypeSupported(type)
      );

      const recorder = mimeType
        ? new window.MediaRecorder(stream, { mimeType })
        : new window.MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setSpeechMessage(
          "Recording failed. Please check microphone permissions and try again."
        );
        setIsListening(false);
      };

      recorder.onstop = async () => {
        setIsListening(false);

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: actualMimeType,
        });
        audioChunksRef.current = [];
        recorderRef.current = null;

        if (!audioBlob.size) {
          setSpeechMessage("No audio was recorded. Please try again.");
          return;
        }

        setSpeechMessage(
          `Preparing recording for ${language} transcription...`
        );

        try {
          // MediaRecorder commonly creates WebM/Opus in Chrome. Gnani rejects
          // WebM, so decode the browser recording and upload a real WAV file.
          const wavBlob = await convertAudioBlobToWav(audioBlob);
          const formData = new FormData();
          formData.append(
            "audio_file",
            wavBlob,
            "bolobodhh-recording.wav"
          );
          formData.append("language", language);
          setSpeechMessage(
            `Sending WAV recording to Gnani for ${language} transcription...`
          );

          const response = await fetch(
            `${API_BASE_URL}/api/speech-to-text`,
            {
              method: "POST",
              body: formData,
            }
          );

          const data = await response.json();

          if (!response.ok) {
            throw new Error(
              data.detail || "Gnani could not transcribe this recording."
            );
          }

          const transcript = (data.transcript || "").trim();

          if (!transcript) {
            throw new Error(
              "Gnani returned an empty transcript. Please try again."
            );
          }

          setQuestion((previous) => {
            const existing = previous.trim();
            return existing ? `${existing} ${transcript}` : transcript;
          });
          setSpeechMessage(
            data.transcript_note ||
              `Transcription complete in ${data.language || language}. Review the text before submitting it.`
          );
        } catch (error) {
          setSpeechMessage(
            error.message ||
              "Could not connect to Gnani. Check that the backend is running."
          );
        }
      };

      recorder.start();
      setIsListening(true);
      setSpeechMessage(
        `Recording in ${language}. Speak your question, then press Stop recording.`
      );
    } catch (error) {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      setIsListening(false);
      setSpeechMessage(
        error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser settings."
          : "Could not access the microphone. Check your browser permissions and try again."
      );
    }
  }

  async function handleQuestionSubmit(event) {
    event.preventDefault();

    if (!question.trim()) {
      setQuestionError("Please type or speak a question first.");
      return;
    }

    if (!studentClass) {
      setQuestionError("Please choose your class in learning preferences.");
      return;
    }

    if (isListening) {
      stopListening();
    }

    setQuestionLoading(true);
    setQuestionError("");
    setSpeechMessage("");
    setQuestionResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question.trim(),
          grade: studentClass,
          language,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Could not submit your question."
        );
      }

      setQuestionResult(data);
      // Keep the answer visible briefly, then clear the old conversation card without reloading the whole app.
      window.setTimeout(() => {
        setQuestionResult((current) => current === data ? null : current);
      }, 60000);
    } catch (err) {
      setQuestionError(
        err.message ||
          "Could not connect to the tutor backend. Check that FastAPI is running."
      );
    } finally {
      setQuestionLoading(false);
    }
  }

  async function listenToAnswer(textToSpeak = null) {
    // The caller may pass either a string or an object. Normalize it before
    // calling trim(), otherwise an object causes: "trim is not a function".
    const candidate =
      typeof textToSpeak === "string"
        ? textToSpeak
        : typeof textToSpeak?.answer === "string"
          ? textToSpeak.answer
          : typeof textToSpeak?.text === "string"
            ? textToSpeak.text
            : typeof questionResult?.answer === "string"
              ? questionResult.answer
              : typeof questionResult?.text === "string"
                ? questionResult.text
                : "";
    const answer = candidate.trim();

    if (!answer) {
      setSpeechMessage("There is no text available to play yet.");
      return;
    }

    // Stop and release any previous Gnani-generated audio before requesting more.
    stopSpeaking();
    setIsGeneratingAudio(true);
    setSpeechMessage(`Generating ${language} audio with Gnani Timbre...`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/text-to-speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: answer,
          language,
          // Explicitly request a Gnani Timbre voice; this is not browser speechSynthesis.
          voice: {
            English: "Yashvi",
            Hindi: "Deepak",
            Hinglish: "Deepak",
            Tamil: "Brinda",
            Marathi: "Omkar",
          }[language],
        }),
      });

      if (!response.ok) {
        let message = "Gnani could not generate the spoken answer.";
        try {
          const errorData = await response.json();
          message = errorData.detail || message;
        } catch {
          // Keep the fallback message if the server did not return JSON.
        }
        throw new Error(message);
      }

      const audioBlob = await response.blob();
      if (!audioBlob.size || !audioBlob.type.startsWith("audio/")) {
        throw new Error("Gnani returned an empty or invalid audio response.");
      }

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(audioBlob);
      audioObjectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onplay = () => {
        setIsSpeaking(true);
        setSpeechMessage("Playing audio generated by Gnani Timbre.");
      };
      audio.onended = () => {
        setIsSpeaking(false);
        setSpeechMessage("Gnani audio playback finished.");
        if (audioObjectUrlRef.current) {
          URL.revokeObjectURL(audioObjectUrlRef.current);
          audioObjectUrlRef.current = null;
        }
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        setSpeechMessage("The Gnani audio could not be played by this browser.");
        audioRef.current = null;
      };

      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      setSpeechMessage(error.message || "Could not generate audio using Gnani TTS.");
    } finally {
      setIsGeneratingAudio(false);
    }
  }

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    setIsSpeaking(false);
  }

  function handlePdfSelection(event) {
    const file = event.target.files?.[0] || null;
    setPdfFile(file);
    setPdfError("");
    setPdfMessage("");
    setPdfExtract(null);
    setPdfSummary(null);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResult(null);
    setQuizError("");
  }

  async function callPdfEndpoint(endpoint, includeLanguage = false) {
    if (!pdfFile) {
      setPdfError("Choose a PDF file first.");
      return;
    }
    setPdfBusy(endpoint);
    setPdfError("");
    setPdfMessage("");
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      if (includeLanguage) {
        formData.append("language", language);
        formData.append("grade", studentClass || "Not specified");
      }
      // OpenAI can temporarily return 429/503 when busy. Retry only those
      // transient failures with a short backoff; do not retry validation errors.
      let response;
      let data;
      const maxAttempts = endpoint === "summarize" ? 3 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        response = await fetch(`${API_BASE_URL}/api/pdf/${endpoint}`, {
          method: "POST",
          body: formData,
        });
        data = await response.json().catch(() => ({}));
        if (response.ok) break;

        const detail = typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail || data);
        const transient = response.status === 429 || response.status === 503;
        if (!transient || attempt === maxAttempts) {
          if (transient && endpoint === "summarize") {
            throw new Error("OpenAI is temporarily busy after 3 attempts. Your PDF text is safe; please try Summarize PDF again in a minute.");
          }
          throw new Error(detail || `PDF ${endpoint} failed.`);
        }
        setPdfMessage(`OpenAI is busy. Retrying summary (${attempt + 1}/${maxAttempts})...`);
        await new Promise((resolve) => window.setTimeout(resolve, attempt * 1800));
      }
      if (endpoint === "extract") {
        setPdfExtract(data);
        setPdfMessage("PDF text extracted successfully. You can now generate a quiz from the extracted content.");
      } else {
        setPdfSummary(data);
        setPdfMessage("PDF summary generated successfully.");
      }
    } catch (error) {
      setPdfError(error.message || "Could not process the PDF. Check that the backend is running.");
    } finally {
      setPdfBusy("");
    }
  }

  async function generateQuiz(sourceText) {
    const textToUse = (sourceText || "").trim();
    if (!textToUse) {
      setQuizError("Extract text from a PDF or generate a summary first.");
      return;
    }
    if (!studentClass) {
      setQuizError("Choose your class in learning preferences first.");
      return;
    }
    setQuizError("");
    setQuizResult(null);
    setQuizBusyForGenerate(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToUse,
          grade: studentClass,
          language,
          num_questions: Number(quizCount),
          difficulty: quizDifficulty,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
        throw new Error(detail || "Could not generate quiz.");
      }
      const questions = Array.isArray(data) ? data : (data.questions || data.quiz || []);
      if (!questions.length) throw new Error("The API responded, but no quiz questions were found.");
      if (quizReviewTimeoutRef.current) window.clearTimeout(quizReviewTimeoutRef.current);
      setQuizQuestions(questions);
      setQuizTopic(String(data.title || pdfSummary?.filename || pdfExtract?.filename || pdfFile?.name || "Study material quiz").replace(/\.pdf$/i, "").trim());
      setQuizAnswers({});
      setQuizResult(null);
      setQuizError("");
      setPdfMessage(`Generated ${questions.length} questions from your study material.`);
      navigateTo("quiz");
    } catch (error) {
      setQuizError(error.message || "Could not generate the quiz. Check that the backend is running.");
    } finally {
      setQuizBusyForGenerate(false);
    }
  }

  async function submitQuiz() {
    if (!quizQuestions.length) {
      setQuizError("Generate a quiz before submitting answers.");
      return;
    }
    if (quizQuestions.some((item) => !quizAnswers[item.id])) {
      setQuizError("Please answer every question before submitting.");
      return;
    }
    setQuizError("");
    setQuizGrading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/quiz/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: quizQuestions,
          answers: quizQuestions.map((item) => ({
            question_id: item.id,
            selected_option: quizAnswers[item.id],
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
        throw new Error(detail || "Could not grade your answers.");
      }
      setQuizResult(data);
      const percentage = Number(data.percentage ?? ((Number(data.score) / Number(data.total || quizQuestions.length)) * 100));
      const feedback = quizFeedbackFor(Number.isFinite(percentage) ? percentage : 0);
      const completedQuiz = {
        id: String(Date.now()),
        topic: quizTopic || pdfSummary?.filename?.replace(/\.pdf$/i, "") || pdfExtract?.filename?.replace(/\.pdf$/i, "") || pdfFile?.name?.replace(/\.pdf$/i, "") || "Study material quiz",
        completedAt: new Date().toISOString(),
        questions: quizQuestions,
        answers: { ...quizAnswers },
        result: data,
      };
      const updatedHistory = [completedQuiz, ...quizHistory].slice(0, 50);
      setQuizHistory(updatedHistory);
      try { localStorage.setItem("bolobodhh_quiz_history", JSON.stringify(updatedHistory)); } catch { /* storage unavailable */ }
      if (user?.id) {
        const { error: historySaveError } = await supabase.from("quiz_history").insert({
          user_id: user.id,
          topic: completedQuiz.topic,
          questions: completedQuiz.questions,
          answers: completedQuiz.answers,
          result: completedQuiz.result,
          completed_at: completedQuiz.completedAt,
        });
        if (historySaveError) console.error("Quiz was saved in this browser but Supabase sync failed:", historySaveError.message);
      }
      // Keep the submitted quiz visible for 2.5 minutes so the learner can review mistakes.
      // Afterwards clear only the active quiz; the compact question/answer history remains saved.
      if (quizReviewTimeoutRef.current) window.clearTimeout(quizReviewTimeoutRef.current);
      quizReviewTimeoutRef.current = window.setTimeout(() => {
        setQuizQuestions([]);
        setQuizAnswers({});
        setQuizResult(null);
        setQuizTopic("");
        setQuizError("");
        quizReviewTimeoutRef.current = null;
      }, 150000);
      // Automatically speak feedback after the grading response arrives.
      window.setTimeout(() => { listenToAnswer(`${feedback.title}. ${feedback.message}`); }, 150);
    } catch (error) {
      setQuizError(error.message || "Could not submit quiz answers. Check that the backend is running.");
    } finally {
      setQuizGrading(false);
    }
  }

  async function saveRevisionNote(event) {
    event.preventDefault();
    const title = revisionNoteTitle.trim();
    const body = revisionNoteBody.trim();
    if (!title || !body) {
      setRevisionNoteMessage("Add both a title and your revision notes first.");
      return;
    }
    const createdAt = new Date().toISOString();
    const localNote = { id: `${Date.now()}`, title, body, createdAt };
    const updated = [localNote, ...revisionNotes];
    setRevisionNotes(updated);
    try { localStorage.setItem("bolobodhh_revision_notes", JSON.stringify(updated)); } catch { /* fallback only */ }
    if (user?.id) {
      try {
        const { data, error } = await supabase.from("revision_notes").insert({ user_id: user.id, title, body }).select("id,title,body,created_at").single();
        if (error) throw error;
        const savedNote = { id: String(data.id), title: data.title, body: data.body, createdAt: data.created_at };
        const synced = [savedNote, ...revisionNotes];
        setRevisionNotes(synced);
        localStorage.setItem("bolobodhh_revision_notes", JSON.stringify(synced));
        setRevisionNoteMessage("Revision note saved to your account.");
      } catch (error) {
        setRevisionNoteMessage(`Saved in this browser; cloud sync failed: ${error.message || "check Supabase setup"}`);
      }
    } else {
      setRevisionNoteMessage("Revision note saved on this device. Sign in to sync it to your account.");
    }
    setRevisionNoteTitle("");
    setRevisionNoteBody("");
  }

  async function deleteRevisionNote(id) {
    const updated = revisionNotes.filter((note) => note.id !== id);
    setRevisionNotes(updated);
    try { localStorage.setItem("bolobodhh_revision_notes", JSON.stringify(updated)); } catch { /* storage unavailable */ }
    if (user?.id && /^\d+$/.test(String(id))) {
      const { error } = await supabase.from("revision_notes").delete().eq("id", Number(id)).eq("user_id", user.id);
      if (error) setRevisionNoteMessage(`Deleted locally, but cloud delete failed: ${error.message}`);
    }
  }

  function quizFeedbackFor(percentage) {
    const messages = {
      Hindi: [
        ["🏆🎉", "बहुत शानदार!", "बहुत अच्छा! आपने सभी प्रश्नों के सही उत्तर दिए। ऐसे ही सीखते रहें!"],
        ["🌟👏", "बहुत बढ़िया!", "आप इस विषय को अच्छी तरह समझ रहे हैं। जिन प्रश्नों में गलती हुई, उन्हें दोबारा देखें और अभ्यास जारी रखें!"],
        ["😊📚", "अच्छी कोशिश — आप और बेहतर कर सकते हैं!", "आपने अच्छा प्रयास किया। थोड़ी और दोहराई करें। सही उत्तर और उनके कारण देखें, फिर चाहें तो दोबारा अभ्यास करें!"],
        ["💪📖", "अभ्यास जारी रखें!", "हार न मानें। विषय को फिर से पढ़ें, अपने नोट्स देखें और जब चाहें दोबारा अभ्यास करें। आप कर सकते हैं!"],
      ],
      Tamil: [
        ["🏆🎉", "அருமை!", "மிகவும் நன்று! எல்லா கேள்விகளுக்கும் சரியாகப் பதிலளித்துள்ளீர்கள். தொடர்ந்து கற்றுக்கொள்ளுங்கள்!"],
        ["🌟👏", "மிகச் சிறப்பு!", "இந்தத் தலைப்பை நன்றாகப் புரிந்துள்ளீர்கள். தவறான பதில்களை மீண்டும் பார்த்து பயிற்சியைத் தொடருங்கள்!"],
        ["😊📚", "நல்ல முயற்சி — இன்னும் மேம்படுத்தலாம்!", "நன்றாக முயன்றீர்கள். சரியான பதில்களையும் விளக்கங்களையும் மீண்டும் பாருங்கள். விரும்பினால் மீண்டும் பயிற்சி செய்யலாம்!"],
        ["💪📖", "தொடர்ந்து பயிற்சி செய்யுங்கள்!", "கவலைப்பட வேண்டாம். தலைப்பை மீண்டும் படித்து, குறிப்புகளைப் பார்த்து, விரும்பும்போது மீண்டும் முயற்சி செய்யுங்கள்!"],
      ],
      Telugu: [
        ["🏆🎉", "అద్భుతం!", "చాలా బాగా చేశారు! అన్ని ప్రశ్నలకు సరైన సమాధానాలు ఇచ్చారు. ఇలాగే నేర్చుకుంటూ ఉండండి!"],
        ["🌟👏", "చాలా బాగుంది!", "ఈ అంశాన్ని బాగా అర్థం చేసుకున్నారు. తప్పుగా వచ్చిన సమాధానాలను మళ్లీ చూసి సాధన కొనసాగించండి!"],
        ["😊📚", "మంచి ప్రయత్నం — ఇంకా మెరుగుపడవచ్చు!", "బాగా ప్రయత్నించారు. సరైన సమాధానాలు, వివరణలను మళ్లీ చూడండి. కావాలంటే మళ్లీ సాధన చేయండి!"],
        ["💪📖", "సాధన కొనసాగించండి!", "నిరుత్సాహపడకండి. అంశాన్ని మళ్లీ చదివి, మీ నోట్స్ చూసి, మీకు నచ్చినప్పుడు మళ్లీ ప్రయత్నించండి!"],
      ],
      Bengali: [
        ["🏆🎉", "অসাধারণ!", "খুব ভালো! আপনি সব প্রশ্নের সঠিক উত্তর দিয়েছেন। এভাবেই শিখতে থাকুন!"],
        ["🌟👏", "দারুণ কাজ!", "আপনি বিষয়টি ভালো বুঝেছেন। ভুল উত্তরগুলো আবার দেখে অনুশীলন চালিয়ে যান!"],
        ["😊📚", "ভালো চেষ্টা — আরও উন্নতি করতে পারবেন!", "আপনি ভালো চেষ্টা করেছেন। সঠিক উত্তর ও ব্যাখ্যাগুলো আবার দেখুন। চাইলে আবার অনুশীলন করুন!"],
        ["💪📖", "অনুশীলন চালিয়ে যান!", "হাল ছাড়বেন না। বিষয়টি আবার পড়ুন, নোট দেখুন, আর ইচ্ছা হলে আবার চেষ্টা করুন!"],
      ],
      Kannada: [
        ["🏆🎉", "ಅದ್ಭುತ!", "ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ! ಎಲ್ಲಾ ಪ್ರಶ್ನೆಗಳಿಗೆ ಸರಿಯಾದ ಉತ್ತರ ನೀಡಿದ್ದೀರಿ. ಹೀಗೆ ಕಲಿಯುತ್ತಿರಿ!"],
        ["🌟👏", "ಬಹಳ ಚೆನ್ನಾಗಿದೆ!", "ಈ ವಿಷಯವನ್ನು ಚೆನ್ನಾಗಿ ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೀರಿ. ತಪ್ಪಾದ ಉತ್ತರಗಳನ್ನು ಮತ್ತೆ ನೋಡಿ ಅಭ್ಯಾಸ ಮುಂದುವರಿಸಿ!"],
        ["😊📚", "ಒಳ್ಳೆಯ ಪ್ರಯತ್ನ — ಇನ್ನಷ್ಟು ಉತ್ತಮವಾಗಬಹುದು!", "ಚೆನ್ನಾಗಿ ಪ್ರಯತ್ನಿಸಿದ್ದೀರಿ. ಸರಿಯಾದ ಉತ್ತರಗಳು ಮತ್ತು ವಿವರಣೆಗಳನ್ನು ಮತ್ತೆ ನೋಡಿ. ಬೇಕಾದರೆ ಮತ್ತೆ ಅಭ್ಯಾಸ ಮಾಡಿ!"],
        ["💪📖", "ಅಭ್ಯಾಸ ಮುಂದುವರಿಸಿ!", "ಬಿಟ್ಟುಕೊಡಬೇಡಿ. ವಿಷಯವನ್ನು ಮತ್ತೆ ಓದಿ, ಟಿಪ್ಪಣಿಗಳನ್ನು ನೋಡಿ, ಸಿದ್ಧರಾದಾಗ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ!"],
      ],
      Malayalam: [
        ["🏆🎉", "മികച്ചത്!", "വളരെ നന്നായി! എല്ലാ ചോദ്യങ്ങൾക്കും ശരിയായ ഉത്തരം നൽകി. ഇങ്ങനെ പഠിച്ചുകൊണ്ടിരിക്കുക!"],
        ["🌟👏", "വളരെ നന്നായി!", "ഈ വിഷയം നന്നായി മനസ്സിലാക്കിയിട്ടുണ്ട്. തെറ്റായ ഉത്തരങ്ങൾ വീണ്ടും പരിശോധിച്ച് പരിശീലനം തുടരുക!"],
        ["😊📚", "നല്ല ശ്രമം — ഇനിയും മെച്ചപ്പെടുത്താം!", "നന്നായി ശ്രമിച്ചു. ശരിയായ ഉത്തരങ്ങളും വിശദീകരണങ്ങളും വീണ്ടും നോക്കുക. താൽപ്പര്യമുണ്ടെങ്കിൽ വീണ്ടും പരിശീലിക്കാം!"],
        ["💪📖", "പരിശീലനം തുടരുക!", "മനസ്സ് മടിക്കേണ്ട. വിഷയം വീണ്ടും വായിച്ച് കുറിപ്പുകൾ നോക്കി തയ്യാറാകുമ്പോൾ വീണ്ടും ശ്രമിക്കുക!"],
      ],
      Marathi: [
        ["🏆🎉", "उत्कृष्ट!", "खूप छान! तुम्ही सर्व प्रश्नांची योग्य उत्तरे दिली. असेच शिकत राहा!"],
        ["🌟👏", "खूप छान काम!", "तुम्हाला हा विषय चांगला समजला आहे. चुका झालेली उत्तरे पुन्हा पाहा आणि सराव सुरू ठेवा!"],
        ["😊📚", "छान प्रयत्न — आणखी सुधारणा करू शकता!", "तुम्ही चांगला प्रयत्न केला. योग्य उत्तरे आणि स्पष्टीकरणे पुन्हा पाहा. हवे असल्यास पुन्हा सराव करा!"],
        ["💪📖", "सराव सुरू ठेवा!", "हार मानू नका. विषय पुन्हा वाचा, नोंदी पाहा आणि तयार झाल्यावर पुन्हा प्रयत्न करा!"],
      ],
      Gujarati: [
        ["🏆🎉", "ઉત્કૃષ્ટ!", "ખૂબ સરસ! તમે બધા પ્રશ્નોના સાચા જવાબ આપ્યા. આમ જ શીખતા રહો!"],
        ["🌟👏", "ખૂબ સરસ કામ!", "તમે આ વિષય સારી રીતે સમજ્યા છો. ખોટા જવાબો ફરી જુઓ અને અભ્યાસ ચાલુ રાખો!"],
        ["😊📚", "સારો પ્રયાસ — તમે વધુ સુધારો કરી શકો છો!", "તમે સારો પ્રયાસ કર્યો. સાચા જવાબો અને સમજૂતી ફરી જુઓ. ઇચ્છો તો ફરી અભ્યાસ કરો!"],
        ["💪📖", "અભ્યાસ ચાલુ રાખો!", "હિંમત ન હારો. વિષય ફરી વાંચો, નોંધો જુઓ અને તૈયાર હો ત્યારે ફરી પ્રયાસ કરો!"],
      ],
      Punjabi: [
        ["🏆🎉", "ਸ਼ਾਨਦਾਰ!", "ਬਹੁਤ ਵਧੀਆ! ਤੁਸੀਂ ਸਾਰੇ ਸਵਾਲਾਂ ਦੇ ਸਹੀ ਜਵਾਬ ਦਿੱਤੇ। ਇਸੇ ਤਰ੍ਹਾਂ ਸਿੱਖਦੇ ਰਹੋ!"],
        ["🌟👏", "ਬਹੁਤ ਵਧੀਆ ਕੰਮ!", "ਤੁਸੀਂ ਇਹ ਵਿਸ਼ਾ ਚੰਗੀ ਤਰ੍ਹਾਂ ਸਮਝਿਆ ਹੈ। ਗਲਤ ਜਵਾਬ ਮੁੜ ਵੇਖੋ ਅਤੇ ਅਭਿਆਸ ਜਾਰੀ ਰੱਖੋ!"],
        ["😊📚", "ਚੰਗੀ ਕੋਸ਼ਿਸ਼ — ਤੁਸੀਂ ਹੋਰ ਸੁਧਾਰ ਕਰ ਸਕਦੇ ਹੋ!", "ਤੁਸੀਂ ਚੰਗੀ ਕੋਸ਼ਿਸ਼ ਕੀਤੀ। ਸਹੀ ਜਵਾਬ ਅਤੇ ਵਿਆਖਿਆਵਾਂ ਮੁੜ ਵੇਖੋ। ਚਾਹੋ ਤਾਂ ਫਿਰ ਅਭਿਆਸ ਕਰੋ!"],
        ["💪📖", "ਅਭਿਆਸ ਜਾਰੀ ਰੱਖੋ!", "ਹੌਸਲਾ ਨਾ ਹਾਰੋ। ਵਿਸ਼ਾ ਮੁੜ ਪੜ੍ਹੋ, ਨੋਟਸ ਵੇਖੋ ਅਤੇ ਤਿਆਰ ਹੋਣ ਤੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ!"],
      ],
    };
    const english = [
      ["🏆🎉", "Excellent work!", "Very well done! You answered every question correctly. Keep learning!"],
      ["🌟👏", "Great job!", "You understand this topic well. Review any mistakes and keep practising!"],
      ["😊📚", "Good effort — you can improve!", "You did well. Review the correct answers and explanations, then practise again whenever you are ready!"],
      ["💪📖", "Keep practising!", "Don't give up. Review the topic and your notes, then try again whenever you feel ready. You can do it!"],
    ];
    const options = messages[language] || english;
    const index = percentage === 100 ? 0 : percentage >= 80 ? 1 : percentage >= 50 ? 2 : 3;
    const [emoji, title, message] = options[index];
    return { emoji, title, message };
  }


  return (
    <main className="student-dashboard">
      <aside
        className={`dashboard-sidebar ${
          mobileMenuOpen ? "sidebar-open" : ""
        }`}
      >
        <a
          className="dashboard-brand"
          href="#dashboard-home"
          onClick={() => navigateTo("home")}
        >
          <span className="dashboard-brand-mark">
            <BookOpen size={22} />
          </span>
          <span>
            BoloBodh<span className="brand-ai"> AI</span>
            <small>YOUR LEARNING SPACE</small>
          </span>
        </a>

        <div className="sidebar-label">LEARNING</div>

        <nav className="dashboard-nav">
          <button
            className={activeSection === "home" ? "nav-active" : ""}
            onClick={() => navigateTo("home")}
          >
            <GraduationCap size={19} />
            Dashboard
          </button>

          <button
            className={activeSection === "doubt" ? "nav-active" : ""}
            onClick={() => navigateTo("doubt")}
          >
            <Brain size={19} />
            Ask a doubt
          </button>

          <button
            className={activeSection === "materials" ? "nav-active" : ""}
            onClick={() => navigateTo("materials")}
          >
            <FileText size={19} />
            Study materials
          </button>

          <button
            className={activeSection === "quiz" ? "nav-active" : ""}
            onClick={() => navigateTo("quiz")}
          >
            <ClipboardList size={19} />
            Practice quizzes
          </button>

          <button
            className={activeSection === "notes" ? "nav-active" : ""}
            onClick={() => navigateTo("notes")}
          >
            <NotebookPen size={19} />
            Revision notes
          </button>

          <button
            className={activeSection === "history" ? "nav-active" : ""}
            onClick={() => navigateTo("history")}
          >
            <ClipboardList size={19} />
            Quiz history
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-quote">
            <Sparkles size={18} />
            <p>Every question is a step towards understanding.</p>
          </div>

          <button className="logout-button" onClick={onLogout}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          className="dashboard-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <button
            className="dashboard-menu-button"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>

          <div className="topbar-label">
            <span className="topbar-dot" />
            YOUR PERSONAL LEARNING SPACE
          </div>

          <div className="student-avatar">
            {firstName.charAt(0).toUpperCase()}
          </div>
        </header>

        <div className="dashboard-content">
          <section className="dashboard-welcome" id="dashboard-home" style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none" }}>
            <div className="welcome-copy">
              <div className="dashboard-kicker">A NEW DAY TO LEARN</div>

              <h1>
                Namaste, {firstName}.
                <br />
                <em>What shall we understand today?</em>
              </h1>

              <p>
                Your curiosity leads the way. Ask questions, explore
                concepts, and learn at your own pace.
              </p>

              <button
                className="dashboard-primary-button"
                onClick={() => navigateTo("doubt")}
              >
                Ask your first doubt <ArrowRight size={17} />
              </button>
            </div>

            <div
              className="welcome-illustration"
              aria-label="Illustration of a learning book"
            >
              <div className="welcome-sun" />
              <div className="welcome-book">
                <BookOpen size={54} strokeWidth={1.3} />
              </div>
              <span className="welcome-sparkle sparkle-a">✳</span>
              <span className="welcome-sparkle sparkle-b">✦</span>
              <span className="welcome-caption">ONE IDEA AT A TIME</span>
            </div>
          </section>

          <section className="student-settings" style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none" }}>
            <div className="settings-heading">
              <span className="settings-icon">
                <GraduationCap size={20} />
              </span>
              <div>
                <h2>Make learning yours</h2>
                <p>Set your learning preferences.</p>
              </div>
            </div>

            {profileLoading ? (
              <p>Loading your saved profile...</p>
            ) : (
              <form onSubmit={saveProfile}>
                <div className="settings-fields">
                  <label>
                    <span>Your name</span>
                    <input
                      type="text"
                      value={studentName}
                      onChange={(event) =>
                        setStudentName(event.target.value)
                      }
                      placeholder="Enter your name"
                      required
                    />
                  </label>

                  <label>
                    <span>Class / grade</span>
                    <div className="dashboard-select">
                      <select
                        value={studentClass}
                        onChange={(event) =>
                          setStudentClass(event.target.value)
                        }
                        required
                      >
                        <option value="">Choose your class</option>
                        {Array.from({ length: 8 }, (_, index) => (
                          <option
                            key={index + 1}
                            value={String(index + 1)}
                          >
                            Class {index + 1}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>

                  <label>
                    <span>Learning language</span>
                    <div className="dashboard-select">
                      <Languages size={17} />
                      <select
                        value={language}
                        onChange={(event) => {
                          const nextLanguage = event.target.value;
                          setLanguage(nextLanguage);
                          // A previous question/transcript must not appear to belong to the new language.
                          setQuestion("");
                          setQuestionResult(null);
                          setQuestionError("");
                          setSpeechMessage("");
                          setPdfError("");
                          setPdfMessage("");
                        }}
                      >
                        {languages.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>
                </div>

                {profileError && (
                  <p
                    role="alert"
                    style={{ color: "#b33d2e", marginTop: 12 }}
                  >
                    {profileError}
                  </p>
                )}

                {profileMessage && (
                  <p
                    role="status"
                    style={{ color: "#526b43", marginTop: 12 }}
                  >
                    {profileMessage}
                  </p>
                )}

                <button
                  type="submit"
                  className="dashboard-primary-button"
                  disabled={profileSaving}
                  style={{ marginTop: 16 }}
                >
                  {profileSaving ? (
                    <>
                      <LoaderCircle className="spin" size={17} />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={17} />
                      Save profile
                    </>
                  )}
                </button>
              </form>
            )}
          </section>

          <section className="learning-section" style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none" }}>
            <div className="dashboard-section-heading">
              <div>
                <div className="dashboard-kicker">YOUR LEARNING TOOLKIT</div>
                <h2>Where would you like to begin?</h2>
              </div>
              <span className="section-count">04 TOOLS</span>
            </div>

            <div className="dashboard-tool-grid">
              {activities.map((activity, index) => {
                const Icon = activity.icon;

                return (
                  <article
                    className="dashboard-tool-card"
                    key={activity.target}
                  >
                    <div className="tool-card-top">
                      <span className={`tool-icon tool-icon-${index + 1}`}>
                        <Icon size={22} />
                      </span>
                      <span className="tool-index">0{index + 1}</span>
                    </div>

                    <h3>{activity.title}</h3>
                    <p>{activity.description}</p>

                    <button onClick={() => navigateTo(activity.target)}>
                      {activity.action} <ArrowRight size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="dashboard-workspace" id="dashboard-doubt" style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none", scrollMarginTop: 24 }}>
            <div className="workspace-heading">
              <span className="workspace-icon">
                <Brain size={22} />
              </span>
              <div>
                <div className="dashboard-kicker">LET'S FIGURE IT OUT</div>
                <h2>What are you curious about?</h2>
                <p>
                  Type your question or use the microphone. Review your
                  transcript before submitting it to the tutor.
                </p>
              </div>
            </div>

            <form className="doubt-form" onSubmit={handleQuestionSubmit}>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={questionPlaceholders[language] || questionPlaceholders.English}
                rows={4}
                maxLength={5000}
                aria-label="Your question"
              />

              <div className="doubt-form-bottom">
                <span>
                  <Languages size={16} />
                  {language}
                  {studentClass ? ` · Class ${studentClass}` : ""}
                </span>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={startListening}
                    disabled={!speechSupported || questionLoading}
                    aria-label={
                      isListening ? "Stop recording" : "Record question"
                    }
                    title={
                      speechSupported
                        ? `Speak in ${language}`
                        : "Speech recognition is unavailable in this browser"
                    }
                  >
                    {isListening ? (
                      <>
                        <MicOff size={16} /> Stop recording
                      </>
                    ) : (
                      <>
                        <Mic size={16} /> Speak
                      </>
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={
                      !question.trim() || questionLoading || !studentClass
                    }
                  >
                    {questionLoading ? (
                      <>
                        <LoaderCircle className="spin" size={16} />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} /> Ask tutor
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>

            {isListening && (
              <p role="status" style={{ marginTop: 12 }}>
                <Mic size={15} style={{ display: "inline" }} /> Listening
                in {language}... Speak clearly, then wait for the transcript.
              </p>
            )}

            {speechMessage && (
              <p role="status" style={{ marginTop: 12 }}>
                {speechMessage}
              </p>
            )}

            {questionError && (
              <p
                role="alert"
                style={{ color: "#b33d2e", marginTop: 12 }}
              >
                {questionError}
              </p>
            )}

            {questionResult && (
              <div
                className="question-result"
                style={{
                  marginTop: 18,
                  padding: 20,
                  borderRadius: 14,
                  background: "#fffefa",
                  border: "1px solid #e9e2d7",
                }}
                aria-live="polite"
              >
                <div className="dashboard-kicker">YOUR QUESTION</div>
                <h3 style={{ marginTop: 8 }}>
                  {questionResult.question}
                </h3>
                <p style={{ marginTop: 8 }}>
                  Class {questionResult.grade} · {questionResult.language}
                </p>

                <div style={{ marginTop: 18 }}>
                  <div className="dashboard-kicker">TUTOR RESPONSE</div>
                  {questionResult.answer ? (
                    <>
                      <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                        {questionResult.answer}
                      </p>
                      <button
                        type="button"
                        className="dashboard-primary-button"
                        style={{ marginTop: 12 }}
                        onClick={isSpeaking ? stopSpeaking : listenToAnswer}
                        disabled={isGeneratingAudio}
                      >
                        {isGeneratingAudio ? (
                          <>
                            <LoaderCircle className="spin" size={16} /> Generating Gnani audio...
                          </>
                        ) : isSpeaking ? (
                          <>
                            <Square size={16} /> Stop listening
                          </>
                        ) : (
                          <>
                            <Volume2 size={16} /> Listen with Gnani AI
                          </>
                        )}
                      </button>
                    </>
                  ) : (
                    <p style={{ marginTop: 8 }}>
                      {questionResult.message ||
                        "Your question was received. The AI explanation will appear here after the AI model is connected."}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setQuestion("");
                    setQuestionResult(null);
                    setQuestionError("");
                    setSpeechMessage("");
                    stopSpeaking();
                  }}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginTop: 16,
                  }}
                >
                  <RotateCcw size={15} /> Ask another question
                </button>
              </div>
            )}

            <p className="dashboard-demo-note">
              Questions are transcribed by Gnani AI, and spoken answers are generated by Gnani Timbre when you select Listen.
            </p>
          </section>

          <section
            className="dashboard-placeholder-section"
            id="dashboard-materials"
            style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none", scrollMarginTop: 24 }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18 }}>
              <span className="placeholder-icon"><FileText size={22} /></span>
              <div>
                <div className="dashboard-kicker">YOUR STUDY LIBRARY</div>
                <h2>Learn from a PDF</h2>
                <p>Upload a textbook or notes PDF to extract its text, create a summary, and build a quiz from what you studied.</p>
              </div>
            </div>
            <div style={{ border: "1px dashed #cfc6b7", borderRadius: 14, padding: 18, background: "#fffefa" }}>
              <label htmlFor="bolobodhh-pdf-upload" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Choose a PDF file</label>
              <input id="bolobodhh-pdf-upload" type="file" accept="application/pdf,.pdf" onChange={handlePdfSelection} style={{ display: "block", maxWidth: "100%", marginBottom: 12 }} />
              {pdfFile && <p style={{ margin: "8px 0 14px", overflowWrap: "anywhere" }}><FileText size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />{pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => callPdfEndpoint("extract")} disabled={!pdfFile || Boolean(pdfBusy)}>
                  {pdfBusy === "extract" ? <><LoaderCircle className="spin" size={16} /> Extracting...</> : <><Upload size={16} /> Extract PDF text</>}
                </button>
                <button type="button" onClick={() => callPdfEndpoint("summarize", true)} disabled={!pdfFile || Boolean(pdfBusy)}>
                  {pdfBusy === "summarize" ? <><LoaderCircle className="spin" size={16} /> Summarizing...</> : <><Sparkles size={16} /> Summarize PDF</>}
                </button>
              </div>
            </div>
            {pdfError && <p role="alert" style={{ color: "#b33d2e", marginTop: 12 }}>{pdfError}</p>}
            {pdfMessage && <p role="status" style={{ color: "#526b43", marginTop: 12 }}>{pdfMessage}</p>}
            {pdfExtract && (
              <div style={{ marginTop: 18, padding: 18, borderRadius: 14, background: "#fffefa", border: "1px solid #e8e3d8" }}>
                <h3>Extracted text</h3>
                <p style={{ marginTop: 8 }}>{pdfExtract.filename || pdfFile?.name}{pdfExtract.page_count != null ? ` · ${pdfExtract.page_count} page(s)` : ""}{pdfExtract.pages_with_text != null ? ` · ${pdfExtract.pages_with_text} page(s) with text` : ""}</p>
                <textarea readOnly value={pdfExtract.text || (pdfExtract.pages || []).map((page) => page.text || "").join("\n\n")} rows={8} aria-label="Extracted PDF text" style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid #e8e3d8", background: "#fffefa" }} />
                <button type="button" className="dashboard-primary-button" style={{ marginTop: 12 }} onClick={() => generateQuiz(pdfExtract.text || (pdfExtract.pages || []).map((page) => page.text || "").join("\n\n"))} disabled={quizBusyForGenerate}>
                  {quizBusyForGenerate ? <><LoaderCircle className="spin" size={16} /> Creating quiz...</> : <>Create quiz from extracted text <ArrowRight size={16} /></>}
                </button>
              </div>
            )}
            {pdfSummary && (
              <div style={{ marginTop: 18, padding: 18, borderRadius: 14, background: "#fffefa", border: "1px solid #e8e3d8" }}>
                <div className="dashboard-kicker">AI-GENERATED SUMMARY</div>
                <h3 style={{ marginTop: 8 }}>{pdfSummary.filename || pdfFile?.name}</h3>
                <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{pdfSummary.summary || "The API returned no summary text."}</p>
                {pdfSummary.pages_read != null && <p style={{ marginTop: 8 }}>Pages read: {pdfSummary.pages_read}</p>}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={isSpeaking ? stopSpeaking : () => listenToAnswer(pdfSummary.summary || "")}
                    disabled={!pdfSummary.summary || isGeneratingAudio}
                  >
                    {isGeneratingAudio ? <><LoaderCircle className="spin" size={16} /> Generating audio...</> : isSpeaking ? <><Square size={16} /> Stop listening</> : <><Volume2 size={16} /> Listen to summary</>}
                  </button>
                  <button type="button" className="dashboard-primary-button" onClick={() => generateQuiz(pdfSummary.summary || "")} disabled={quizBusyForGenerate || !pdfSummary.summary}>
                    {quizBusyForGenerate ? <><LoaderCircle className="spin" size={16} /> Creating quiz...</> : <>Create quiz from summary <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section
            className="dashboard-placeholder-section"
            id="dashboard-quiz"
            style={{ display: ["home", "doubt", "materials", "quiz"].includes(activeSection) ? "block" : "none", scrollMarginTop: 24 }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18 }}>
              <span className="placeholder-icon"><ClipboardList size={22} /></span>
              <div>
                <div className="dashboard-kicker">LEARN BY PRACTISING</div>
                <h2>AI practice quiz</h2>
                <p>Generate multiple-choice questions from your extracted PDF text or summary, then submit your answers for scoring and explanations.</p>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "end", padding: 16, borderRadius: 14, background: "#fffefa", border: "1px solid #e8e3d8" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Number of questions</span>
                <select value={quizCount} onChange={(event) => setQuizCount(event.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #e8e3d8", background: "#fffefa" }}>
                  <option value="5">5 questions</option><option value="10">10 questions</option><option value="15">15 questions</option><option value="20">20 questions</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Difficulty</span>
                <select value={quizDifficulty} onChange={(event) => setQuizDifficulty(event.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #e8e3d8", background: "#fffefa" }}>
                  <option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option>
                </select>
              </label>
              <button type="button" onClick={() => generateQuiz(pdfExtract?.text || pdfSummary?.summary || "")} disabled={quizBusyForGenerate || (!pdfExtract?.text && !pdfSummary?.summary)}>
                {quizBusyForGenerate ? <><LoaderCircle className="spin" size={16} /> Generating...</> : <><Sparkles size={16} /> Generate quiz from latest PDF</>}
              </button>
              {!pdfExtract?.text && !pdfSummary?.summary && <p style={{ flexBasis: "100%", margin: 0 }}>First upload a PDF and extract its text or summarize it in Study materials.</p>}
            </div>
            {quizError && <p role="alert" style={{ color: "#b33d2e", marginTop: 12 }}>{quizError}</p>}
            {quizQuestions.length > 0 && (
              <>
              {quizResult && (() => {
                const percentage = Number(quizResult.percentage ?? ((Number(quizResult.score) / Number(quizResult.total || quizQuestions.length)) * 100));
                const feedback = quizFeedbackFor(Number.isFinite(percentage) ? percentage : 0);
                return <div role="status" style={{ padding: 18, marginTop: 18, borderRadius: 14, background: "#f8f0e9", border: "1px solid #e8e3d8" }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>{feedback.emoji}</div>
                  <h3 style={{ margin: "0 0 8px", color: "#282922" }}>{feedback.title}</h3>
                  <p style={{ margin: 0, color: "#77786d" }}>{feedback.message}</p>
                  <p style={{ margin: "10px 0 0", fontWeight: 700 }}>Your score: {quizResult.score ?? "—"}/{quizResult.total ?? quizQuestions.length} ({Number.isFinite(percentage) ? Math.round(percentage) : 0}%)</p>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "#77786d" }}>Your feedback is spoken automatically using the selected language.</p>
                </div>;
              })()}
              <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
                {quizQuestions.map((item, index) => (
                  <article key={item.id ?? index} style={{ padding: 18, borderRadius: 14, background: "#fffefa", border: "1px solid #e8e3d8" }}>
                    <p style={{ fontWeight: 700, marginBottom: 12 }}><span style={{ color: "#b85d42", marginRight: 8 }}>Q{index + 1}.</span>{item.question}</p>
                    <div style={{ display: "grid", gap: 9 }}>
                      {normalizeQuizOptions(item?.options).map((option, optionIndex) => {
                        const optionText = option.text;
                        const optionValue = option.key;
                        const selected = quizAnswers[item.id] === optionValue;
                        return (
                          <label key={`${item.id ?? index}-${optionIndex}`} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: 10, borderRadius: 9, border: `1px solid ${selected ? "#b85d42" : "#e8e3d8"}`, background: selected ? "#f8f0e9" : "transparent", cursor: "pointer" }}>
                            <input type="radio" name={`quiz-question-${item.id ?? index}`} value={optionValue} checked={selected} onChange={() => { setQuizAnswers((previous) => ({ ...previous, [item.id]: optionValue })); setQuizResult(null); }} />
                            <span>{optionText}</span>
                          </label>
                        );
                      })}
                    </div>
                    {quizResult && (
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: "#f8f6f0" }}>
                        <p style={{ fontWeight: 600 }}>{quizResult.results?.[index]?.is_correct ? (language === "Hindi" ? "सही उत्तर" : language === "Tamil" ? "சரியான பதில்" : language === "Telugu" ? "సరైన సమాధానం" : "Correct") : (language === "Hindi" ? "उत्तर देखें" : language === "Tamil" ? "பதிலைப் பாருங்கள்" : language === "Telugu" ? "సమాధానాన్ని చూడండి" : "Review answer")}</p>
                        <p>{language === "Hindi" ? "सही उत्तर:" : language === "Tamil" ? "சரியான பதில்:" : language === "Telugu" ? "సరైన సమాధానం:" : "Correct answer:"} {(() => { const key = quizResult.results?.[index]?.correct_answer || item.correct_answer; const opts = item.options; return opts && typeof opts === "object" && !Array.isArray(opts) ? `${key}. ${opts[key] ?? key}` : key; })()}</p>
                        <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{quizResult.results?.[index]?.explanation || item.explanation}</p>
                      </div>
                    )}
                  </article>
                ))}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="dashboard-primary-button" onClick={submitQuiz} disabled={quizGrading || Boolean(quizResult)}>
                    {quizGrading ? <><LoaderCircle className="spin" size={16} /> Checking answers...</> : <><CheckCircle2 size={16} /> Submit answers</>}
                  </button>
                  {quizResult && <><strong>Score: {quizResult.score ?? "—"} / {quizResult.total ?? quizQuestions.length} ({quizResult.percentage ?? "—"}%)</strong><button type="button" onClick={() => { setQuizAnswers({}); setQuizResult(null); setQuizError(""); }}>Try again</button></>}
                </div>
                {quizResult && <p role="status">{language === "Hindi" ? "क्विज़ जमा हो गई। हर प्रश्न के नीचे सही उत्तर और उसका कारण देखें।" : language === "Tamil" ? "வினாடி வினா சமர்ப்பிக்கப்பட்டது. ஒவ்வொரு கேள்விக்கும் கீழே சரியான பதிலும் விளக்கமும் உள்ளன." : language === "Telugu" ? "క్విజ్ సమర్పించబడింది. ప్రతి ప్రశ్న కింద సరైన సమాధానం, వివరణ చూడండి." : "Quiz submitted. Review the answer and explanation shown under each question."}</p>}
              </div>
              </>
            )}
          </section>

          <section className="dashboard-placeholder-section" id="dashboard-quiz-history" style={{ display: activeSection === "history" ? "block" : "none" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
              <span className="placeholder-icon"><ClipboardList size={22} /></span>
              <div>
                <div className="dashboard-kicker">YOUR LEARNING HISTORY</div>
                <h2 style={{ margin: "4px 0" }}>Past quiz questions</h2>
                <p style={{ margin: 0 }}>Completed quiz questions, your selected answers, correct answers, and explanations are saved to your Supabase account for reference.</p>
              </div>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {quizHistory.length === 0 ? <p style={{ color: "#77786d" }}>Your completed quizzes will appear here.</p> : quizHistory.map((entry) => (
                <article key={entry.id} style={{ padding: 16, border: "1px solid #e8e3d8", borderRadius: 12, background: "#fffefa" }}>
                  <h3 style={{ margin: "0 0 6px", color: "#282922" }}>{entry.topic || "Study material quiz"}</h3>
                  <small style={{ color: "#77786d" }}>{entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "Completed quiz"}</small>
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {(entry.questions || []).map((item, index) => {
                      const selected = entry.answers?.[item.id];
                      const resultItem = entry.result?.results?.[index] || {};
                      const correctKey = resultItem.correct_answer || item.correct_answer || "—";
                      const optionText = (key) => {
                        const options = item.options;
                        if (options && typeof options === "object" && !Array.isArray(options)) return options[key] ? `${key}. ${options[key]}` : key;
                        const normalized = normalizeQuizOptions(options);
                        return normalized.find((option) => option.key === key)?.text || key || "Not answered";
                      };
                      return <div key={`${entry.id}-${item.id ?? index}`} style={{ paddingTop: 10, borderTop: "1px solid #eee8de" }}>
                        <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Q{index + 1}. {item.question}</p>
                        <p style={{ margin: "0 0 4px", color: resultItem.is_correct ? "#697456" : "#b85d42" }}>{language === "Hindi" ? "आपका उत्तर:" : language === "Tamil" ? "உங்கள் பதில்:" : language === "Telugu" ? "మీ సమాధానం:" : "Your answer:"} {optionText(selected || "Not answered")}</p>
                        <p style={{ margin: "0 0 4px", color: "#697456" }}>{language === "Hindi" ? "सही उत्तर:" : language === "Tamil" ? "சரியான பதில்:" : language === "Telugu" ? "సరైన సమాధానం:" : "Correct answer:"} {optionText(correctKey)}</p>
                        {!resultItem.is_correct && <p style={{ margin: "0 0 4px", color: "#b85d42", fontWeight: 600 }}>{language === "Hindi" ? "इस प्रश्न में गलती हुई।" : language === "Tamil" ? "இந்தக் கேள்வியில் தவறு ஏற்பட்டது." : language === "Telugu" ? "ఈ ప్రశ్నకు సమాధానం తప్పు." : "This answer was incorrect."}</p>}
                        {(resultItem.explanation || item.explanation) && <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#77786d" }}>{resultItem.explanation || item.explanation}</p>}
                      </div>;
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-placeholder-section" id="dashboard-notes" style={{ display: activeSection === "notes" ? "block" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span className="placeholder-icon"><NotebookPen size={22} /></span>
              <div>
                <div className="dashboard-kicker">KEEP WHAT YOU LEARN</div>
                <h2 style={{ margin: "4px 0" }}>Revision notes</h2>
                <p style={{ margin: 0 }}>Write and save key points to review later. Notes sync to your Supabase account and remain available when you sign in again.</p>
              </div>
            </div>
            <form onSubmit={saveRevisionNote} style={{ display: "grid", gap: 10, marginTop: 16 }}>
              <input aria-label="Revision note title" value={revisionNoteTitle} onChange={(event) => setRevisionNoteTitle(event.target.value)} placeholder="Topic (e.g. Photosynthesis)" maxLength={120} style={{ padding: 12, borderRadius: 9, border: "1px solid #e8e3d8", background: "#fffefa", color: "#282922", font: "inherit" }} />
              <textarea aria-label="Revision note content" value={revisionNoteBody} onChange={(event) => setRevisionNoteBody(event.target.value)} placeholder="Write important points, definitions, or things to remember..." rows={4} style={{ padding: 12, borderRadius: 9, border: "1px solid #e8e3d8", background: "#fffefa", color: "#282922", font: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><button type="submit" className="dashboard-primary-button"><Save size={16} /> Save revision note</button>{revisionNoteMessage && <span role="status" style={{ color: "#697456", fontSize: 13 }}>{revisionNoteMessage}</span>}</div>
            </form>
            <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
              {revisionNotes.length === 0 ? <p style={{ color: "#77786d" }}>No revision notes yet. Add your first note above.</p> : revisionNotes.map((note) => <article key={note.id} style={{ padding: 16, border: "1px solid #e8e3d8", borderRadius: 12, background: "#fffefa" }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}><h3 style={{ margin: "0 0 8px", color: "#282922" }}>{note.title}</h3><button type="button" onClick={() => deleteRevisionNote(note.id)} aria-label={`Delete ${note.title}`} style={{ border: "1px solid #e8e3d8", borderRadius: 8, padding: "5px 9px", background: "transparent", cursor: "pointer" }}>Delete</button></div><p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#77786d" }}>{note.body}</p><small style={{ display: "block", marginTop: 10, color: "#77786d" }}>{note.createdAt ? new Date(note.createdAt).toLocaleString() : "Saved note"}</small></article>)}
            </div>
          </section>

          <footer className="dashboard-footer">
            <a href="#dashboard-home">BoloBodh AI</a>
            <span>Learn at your pace. Understand in your language.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
