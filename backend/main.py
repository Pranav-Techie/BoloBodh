import base64
import binascii
import json
import os
import re
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pypdf import PdfReader

# Always load the .env next to this file, regardless of the terminal's cwd.
load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(
    title="BoloBodh AI",
    description="A multilingual AI learning platform",
    version="0.9.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use the existing Gnani credential. Never print or return the key.
GNANI_API_KEY_ID = os.getenv("GNANI_API_KEY_ID", "").strip()
GNANI_STT_URL = "https://api.vachana.ai/stt/v3"
GNANI_TTS_URL = "https://api.vachana.ai/api/v1/tts/sse"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-6-luna").strip()
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

SUPPORTED_LANGUAGES = {
    "English": "en-IN",
    "Hindi": "hi-IN",
    # Hinglish uses Hindi recognition as the closest supported speech locale.
    "Hinglish": "hi-IN",
    "Tamil": "ta-IN",
    "Bengali": "bn-IN",
    "Telugu": "te-IN",
    "Kannada": "kn-IN",
    "Malayalam": "ml-IN",
    "Marathi": "mr-IN",
    "Gujarati": "gu-IN",
    "Punjabi": "pa-IN",
}
TTS_LANGUAGES = SUPPORTED_LANGUAGES.copy()

# Keep known tested voices. Confirm pronunciation for fallback voices in each locale.
DEFAULT_TTS_VOICES = {
    "English": "Yashvi",
    "Hindi": "Deepak",
    # Hinglish speech is sent to the Hindi TTS locale; Roman-script pronunciation must be tested.
    "Hinglish": "Deepak",
    "Tamil": "Brinda",
    "Bengali": "Yashvi",
    "Telugu": "Yashvi",
    "Kannada": "Yashvi",
    "Malayalam": "Yashvi",
    "Marathi": "Omkar",
    "Gujarati": "Yashvi",
    "Punjabi": "Yashvi",
}


class QuestionRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=5000)
    grade: str = Field(..., min_length=1, max_length=30)
    language: str = Field(..., min_length=1, max_length=50)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    language: str = Field(..., min_length=1, max_length=50)
    voice: str | None = None


# Phase 3 quiz request/response schemas.
class QuizRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=45000)
    grade: str = Field(..., min_length=1, max_length=30)
    language: str = Field(..., min_length=1, max_length=50)
    num_questions: int = Field(default=5, ge=5, le=15)
    difficulty: Literal["Easy", "Medium", "Hard"] = "Easy"


class QuizAnswer(BaseModel):
    question_id: int = Field(..., ge=1)
    selected_option: Literal["A", "B", "C", "D"]


class QuizGradeRequest(BaseModel):
    # Questions should be the exact quiz object returned by /api/quiz/generate.
    questions: list[dict[str, Any]] = Field(..., min_length=1, max_length=15)
    answers: list[QuizAnswer] = Field(..., max_length=15)


def _clean_student_text(text: str) -> str:
    """Remove raw Markdown markers that are awkward when displayed/spoken to children."""
    cleaned_lines = []
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            cleaned_lines.append("")
            continue
        # Turn Markdown headings into plain headings and avoid visible ### / #1 artifacts.
        line = re.sub(r"^#{1,6}\s*\d*\s*[.):–-]?\s*", "", line)
        line = re.sub(r"^#+\s*", "", line)
        line = re.sub(r"^#\s*\d+\s*[:.)–-]?\s*", "", line)
        # Remove bold/italic/code decoration while keeping the actual words.
        line = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", line)
        line = re.sub(r"`([^`]+)`", r"\1", line)
        # Use a simple bullet rather than raw Markdown dash syntax.
        line = re.sub(r"^[-*]\s+", "• ", line)
        cleaned_lines.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned_lines)).strip()


def _openai_generate_text(prompt: str, *, max_output_tokens: int = 3000) -> str:
    """Generate text through OpenAI Responses API without exposing the API key."""
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="OpenAI is not configured. Add OPENAI_API_KEY to backend/.env and restart the backend.",
        )

    try:
        response = requests.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_MODEL,
                "input": prompt,
                "max_output_tokens": max_output_tokens,
            },
            timeout=(10, 120),
        )
    except requests.Timeout as exc:
        raise HTTPException(status_code=504, detail="OpenAI took too long to respond. Please try again.") from exc
    except requests.RequestException as exc:
        print("OpenAI connection error:", type(exc).__name__, str(exc)[:500])
        raise HTTPException(status_code=502, detail="Could not connect to OpenAI. Check your internet connection.") from exc

    if not response.ok:
        # Log only a bounded provider response; never log the API key or request headers.
        provider_message = ""
        try:
            error_data = response.json()
            provider_message = str(error_data.get("error", {}).get("message", ""))
        except (ValueError, AttributeError):
            provider_message = response.text[:500]
        print(f"OpenAI API HTTP {response.status_code}: {provider_message[:700]}")

        if response.status_code == 401:
            detail = "OpenAI rejected the API key. Check OPENAI_API_KEY in backend/.env."
        elif response.status_code == 429:
            detail = "OpenAI quota or rate limit reached. Check API billing, credits, and usage limits."
        elif response.status_code in (403, 404):
            detail = f"OpenAI could not access model '{OPENAI_MODEL}'. Check the model ID and project permissions."
        elif response.status_code >= 500:
            detail = "OpenAI is temporarily unavailable. Please try again shortly."
        else:
            detail = f"OpenAI request failed (HTTP {response.status_code}). Check the backend terminal."
        raise HTTPException(status_code=503 if response.status_code in (429, 500, 502, 503, 504) else 502, detail=detail)

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="OpenAI returned an invalid response.") from exc

    # Responses API returns generated text in output[].content[].text.
    output_parts = []
    for item in data.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") in ("output_text", "text"):
                text_value = content.get("text")
                if isinstance(text_value, str):
                    output_parts.append(text_value)

    generated = "\n".join(output_parts).strip()
    if not generated:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response. Please try again.")
    return generated


@app.get("/")
def home():
    return {
        "message": "Welcome to BoloBodh AI!",
        "status": "running",
        "features": ["AI tutor", "speech-to-text", "text-to-speech", "PDF learning", "AI quiz"],
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "application": "BoloBodh AI",
        "openai_configured": bool(OPENAI_API_KEY),
        "openai_model": OPENAI_MODEL if OPENAI_API_KEY else None,
        "gnani_stt_configured": bool(GNANI_API_KEY_ID),
        "gnani_tts_configured": bool(GNANI_API_KEY_ID),
        "gnani_tts_model": "timbre-v2.5",
        "pdf_learning_configured": True,
        "ai_quiz_configured": bool(OPENAI_API_KEY),
        "supported_languages": list(SUPPORTED_LANGUAGES.keys()),
    }


@app.get("/api/languages")
def get_languages():
    return {
        "languages": [
            {"name": name, "code": code}
            for name, code in SUPPORTED_LANGUAGES.items()
        ]
    }


@app.post("/api/speech-to-text")
def speech_to_text(
    audio_file: UploadFile = File(...),
    language: str = Form(...),
):
    if not GNANI_API_KEY_ID:
        raise HTTPException(
            status_code=500,
            detail="Gnani API Key ID is not configured in backend/.env.",
        )

    language = language.strip()
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported language. Choose a language from /api/languages.",
        )

    audio = audio_file.file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")
    if len(audio) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds the 15 MB limit.")

    language_code = SUPPORTED_LANGUAGES[language]
    if language_code == "pa-IN":
        language_code = "pa-guru-IN"

    try:
        response = requests.post(
            GNANI_STT_URL,
            headers={"X-API-Key-ID": GNANI_API_KEY_ID},
            files={
                "audio_file": (
                    audio_file.filename or "recording.wav",
                    audio,
                    audio_file.content_type or "application/octet-stream",
                )
            },
            data={
                "language_code": language_code,
                "preferred_language": language_code,
                "format": "transcribe",
                "itn_native_numerals": "true",
            },
            timeout=60,
        )
        if not response.ok:
            print(f"Gnani STT HTTP {response.status_code}:", response.text[:1000])
            raise HTTPException(
                status_code=502,
                detail=f"Gnani speech recognition returned HTTP {response.status_code}. Check backend terminal.",
            )
        try:
            result = response.json()
        except ValueError as exc:
            print("Gnani STT returned non-JSON response:", response.text[:500])
            raise HTTPException(
                status_code=502,
                detail="Gnani returned an invalid speech-recognition response.",
            ) from exc
    except HTTPException:
        raise
    except requests.Timeout as exc:
        print("Gnani STT timed out:", repr(exc))
        raise HTTPException(status_code=504, detail="Gnani speech recognition timed out. Try again.") from exc
    except requests.RequestException as exc:
        print("Gnani STT connection error:", repr(exc))
        raise HTTPException(status_code=502, detail="Could not connect to Gnani speech recognition.") from exc

    transcript = result.get("transcript", "") if isinstance(result, dict) else ""
    transcript = transcript.strip() if isinstance(transcript, str) else ""
    if not transcript or (isinstance(result, dict) and not result.get("success", True)):
        provider_message = result.get("message") if isinstance(result, dict) else None
        print("Gnani STT returned no transcript:", str(result)[:1000])
        detail = "Gnani did not return a usable transcript."
        if provider_message:
            detail = f"Gnani did not return a usable transcript: {provider_message}"
        raise HTTPException(status_code=502, detail=detail)

    # Gnani may return Devanagari even when the learner speaks mixed Hindi/English.
    # Normalize that transcript according to the profile language so the review box
    # and tutor receive the intended script/language.
    transcript_note = None
    has_devanagari = bool(re.search(r"[\u0900-\u097F]", transcript))
    if has_devanagari and language in {"English", "Hinglish"} and OPENAI_API_KEY:
        if language == "English":
            normalize_prompt = f"""
Convert this speech-recognition transcript into clear, concise English.
Translate any Hindi words into English while preserving the student's exact intent.
Keep scientific/technical terms accurate. Return only the corrected English transcript,
with no explanation or quotation marks.

Transcript:
{transcript}
""".strip()
        else:
            normalize_prompt = f"""
Transliterate this Hindi/Hinglish speech-recognition transcript into natural Hinglish
written ONLY with Latin/Roman letters. Preserve the spoken meaning and familiar Hindi
words; do not translate it into formal English and do not use Devanagari script.
Return only the Roman-script transcript, with no explanation or quotation marks.

Transcript:
{transcript}
""".strip()
        try:
            normalized = _openai_generate_text(normalize_prompt, max_output_tokens=300)
            if normalized and normalized.strip():
                transcript = normalized.strip().strip('"“”')
                transcript_note = (
                    "Speech transcript converted to English for your English profile."
                    if language == "English"
                    else "Speech transcript written in Roman-script Hinglish."
                )
        except HTTPException as exc:
            # Keep speech-to-text usable if optional transcript normalization fails.
            print("Transcript normalization skipped:", exc.detail)
            transcript_note = "Transcript normalization was unavailable; please review the transcript."
    elif has_devanagari and language in {"English", "Hinglish"}:
        transcript_note = "Transcript may need manual correction because OpenAI normalization is not configured."

    return {
        "status": "success",
        "language": language,
        "language_code": language_code,
        "transcript": transcript,
        "transcript_note": transcript_note,
    }


@app.post("/api/questions")
def submit_question(payload: QuestionRequest):
    question = payload.question.strip()
    grade = payload.grade.strip()
    language = payload.language.strip()

    if not question:
        raise HTTPException(status_code=422, detail="Please enter a question.")
    if not grade or not language:
        raise HTTPException(status_code=422, detail="Please select your grade and preferred language.")
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI is not configured. Add OPENAI_API_KEY to backend/.env.")

    if language == "Hinglish":
        language_instructions = "Answer in natural, conversational Hinglish written ONLY in Latin/Roman letters. Use Hindi words and familiar Hinglish phrasing, for example: 'Baarish tab hoti hai jab badalon mein paani ki boondein milkar bhaari ho jaati hain aur neeche girti hain.' Do not use Devanagari script. Do not switch to formal English. Keep technical terms simple."
    elif language == "Hindi":
        language_instructions = "Answer in natural, simple Hindi using Devanagari script, even if the student's question is typed in English letters or Hinglish. Do not answer in English just because the question is written in Roman letters."
    elif language == "English":
        language_instructions = (
            "Answer entirely in clear, simple English using Latin letters, even if the "
            "student's question contains Hindi, Hinglish, or Devanagari text. Translate "
            "the intent of the question into English; do not answer in Hindi or Hinglish."
        )
    else:
        language_instructions = f"Answer entirely in {language}, using the normal script for that language."

    prompt = f"""
You are BoloBodh AI, a friendly, patient tutor for Indian students.
Student grade/class: {grade}
Preferred response language: {language}
Student question: {question}

{language_instructions}
Include headings, examples, encouragement, and any closing sentence in the selected response style.
Adapt the depth, vocabulary, sentence length, and examples to the student's selected class.
For Classes 1–4, use very short sentences, familiar everyday examples, and explain one idea at a time.
For Classes 5–8, give a clear step-by-step explanation and age-appropriate subject terminology, defining difficult words simply.
Never assume the student already knows advanced concepts. If the question is beyond the student's class level, gently explain the foundation first.
When useful, end with a short, warm, language-appropriate encouragement such as “Good job!”, “Keep practising!”, or the natural equivalent in {language}; do not force the same phrase into every answer.
Do not use Markdown heading markers such as # or ##, do not prefix headings with #1/#2, and do not repeat numbered labels. Avoid unnecessary English words unless they are proper names or technical terms that should remain in English. Use plain text and simple bullets only. If uncertain, say so rather than inventing facts.
""".strip()

    answer = _clean_student_text(_openai_generate_text(prompt, max_output_tokens=2500))
    return {
        "status": "success",
        "question": question,
        "grade": grade,
        "language": language,
        "answer": answer,
    }



def _extract_audio_from_payload(payload: Any) -> list[bytes]:
    """Extract base64 audio from common nested JSON event shapes."""
    chunks: list[bytes] = []

    if isinstance(payload, list):
        for item in payload:
            chunks.extend(_extract_audio_from_payload(item))
        return chunks
    if not isinstance(payload, dict):
        return chunks

    for key in ("audio", "audio_chunk", "audio_base64", "audioContent", "audio_content"):
        encoded = payload.get(key)
        if isinstance(encoded, dict):
            encoded = encoded.get("data") or encoded.get("audio") or encoded.get("base64")
        if isinstance(encoded, str) and encoded.strip():
            encoded = encoded.strip()
            if encoded.startswith("data:") and "," in encoded:
                encoded = encoded.split(",", 1)[1]
            try:
                decoded = base64.b64decode(encoded, validate=True)
                if decoded:
                    chunks.append(decoded)
            except (ValueError, binascii.Error):
                pass

    if not chunks:
        for key in ("data", "result", "output", "chunk"):
            nested = payload.get(key)
            if isinstance(nested, (dict, list)):
                chunks.extend(_extract_audio_from_payload(nested))
    return chunks


def _decode_gnani_tts_sse(stream_text: str) -> bytes:
    """Parse Gnani's Server-Sent Events stream and surface provider errors."""
    normalized = stream_text.replace("\r\n", "\n").replace("\r", "\n")
    audio_chunks: list[bytes] = []
    event_names: list[str] = []
    provider_errors: list[str] = []

    for block in re.split(r"\n\s*\n", normalized.strip()):
        event_name = ""
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())

        if event_name:
            event_names.append(event_name)
        if not data_lines:
            continue

        try:
            event_payload = json.loads("\n".join(data_lines).strip())
        except json.JSONDecodeError:
            continue

        if isinstance(event_payload, dict) and (
            event_name.lower() == "error" or event_payload.get("error")
        ):
            message = event_payload.get("message") or event_payload.get("error") or "Unknown Gnani TTS error"
            provider_errors.append(f"status {event_payload.get('status_code', 'unknown')}: {message}")
            continue
        audio_chunks.extend(_extract_audio_from_payload(event_payload))

    if not audio_chunks:
        for line in normalized.splitlines():
            stripped = line.strip()
            if stripped.startswith("data:"):
                stripped = stripped[len("data:"):].strip()
            if not stripped or stripped.startswith(("event:", "id:", "retry:", ":")):
                continue
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and (parsed.get("error") or parsed.get("status") == "error"):
                message = parsed.get("message") or parsed.get("error") or "Unknown Gnani TTS error"
                provider_errors.append(f"status {parsed.get('status_code', 'unknown')}: {message}")
                continue
            audio_chunks.extend(_extract_audio_from_payload(parsed))

    if not audio_chunks:
        print("Gnani TTS event names:", event_names[:30])
        if provider_errors:
            message = "; ".join(provider_errors[:3])
            print("Gnani TTS provider error:", message)
            raise ValueError(f"Gnani TTS provider rejected the request: {message}")
        print("Gnani TTS stream preview:", normalized[:700].replace("\n", " "))
        raise ValueError("Gnani TTS stream contained no decodable audio chunks.")

    audio = b"".join(audio_chunks)
    if not audio:
        raise ValueError("Gnani TTS decoded to an empty audio file.")
    return audio


@app.post("/api/text-to-speech")
def text_to_speech(payload: TTSRequest):
    if not GNANI_API_KEY_ID:
        raise HTTPException(status_code=500, detail="Gnani API Key ID is missing. Configure GNANI_API_KEY_ID in backend/.env.")

    text = payload.text.strip()
    language = payload.language.strip()
    if not text:
        raise HTTPException(status_code=422, detail="There is no answer text to speak.")
    if len(text) > 5000:
        raise HTTPException(status_code=422, detail="Text is too long for one speech request. Shorten it.")
    if language not in TTS_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS language '{language}'. Choose one from /api/languages.")

    language_code = TTS_LANGUAGES[language]
    if language_code == "pa-IN":
        language_code = "pa-guru-IN"
    voice = payload.voice.strip() if payload.voice and payload.voice.strip() else DEFAULT_TTS_VOICES.get(language, "Yashvi")

    tts_payload = {
        "audio_config": {
            "bitrate": "192k",
            "container": "mp3",
            "encoding": "linear_pcm",
            "num_channels": 1,
            "sample_rate": 44100,
            "sample_width": 2,
        },
        "language": language_code,
        "model": "timbre-v2.5",
        "text": text,
        "voice": voice,
    }

    try:
        upstream = requests.post(
            GNANI_TTS_URL,
            headers={
                "X-API-Key-ID": GNANI_API_KEY_ID,
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json=tts_payload,
            timeout=(10, 90),
        )
        if not upstream.ok:
            print(f"Gnani TTS HTTP {upstream.status_code}:", upstream.text[:1500])
            raise HTTPException(status_code=502, detail=f"Gnani TTS returned upstream HTTP {upstream.status_code}. Check backend terminal.")
        audio_bytes = _decode_gnani_tts_sse(upstream.text)
    except HTTPException:
        raise
    except ValueError as exc:
        print("Gnani TTS parsing/provider error:", str(exc)[:1500])
        raise HTTPException(status_code=502, detail=str(exc)[:1200]) from exc
    except requests.Timeout as exc:
        print("Gnani TTS timed out:", repr(exc))
        raise HTTPException(status_code=504, detail="Gnani TTS timed out. Please try again.") from exc
    except requests.RequestException as exc:
        print("Gnani TTS connection error:", repr(exc))
        raise HTTPException(status_code=502, detail="Could not connect to Gnani TTS. Check backend terminal.") from exc

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Audio-Provider": "Gnani Timbre v2.5",
            "X-Audio-Voice": voice,
            "X-Audio-Language": language_code,
        },
    )


# ---------------------------------------------------------------------------
# PHASE 2: PDF LEARNING
# ---------------------------------------------------------------------------

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 100
MAX_PDF_TEXT_CHARS = 45000


def _read_pdf_text(pdf_bytes: bytes) -> tuple[int, list[dict[str, Any]], str]:
    """Return total pages, page text records, and bounded extracted text."""
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        if reader.is_encrypted:
            raise HTTPException(status_code=400, detail="This PDF is password-protected. Upload an unlocked PDF.")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise HTTPException(status_code=413, detail=f"PDF exceeds the {MAX_PDF_PAGES}-page limit.")

        pages: list[dict[str, Any]] = []
        text_parts: list[str] = []
        char_count = 0
        for page_number, page in enumerate(reader.pages, start=1):
            page_text = (page.extract_text() or "").strip()
            if page_text:
                pages.append({"page": page_number, "text": page_text})
                remaining = MAX_PDF_TEXT_CHARS - char_count
                if remaining > 0:
                    clipped = page_text[:remaining]
                    text_parts.append(f"Page {page_number}\n{clipped}")
                    char_count += len(clipped)
        if not pages:
            raise HTTPException(
                status_code=422,
                detail="No selectable text was found. This may be a scanned PDF that needs OCR.",
            )
        return len(reader.pages), pages, "\n\n".join(text_parts)
    except HTTPException:
        raise
    except Exception as exc:
        print("PDF extraction failed:", type(exc).__name__, str(exc)[:500])
        raise HTTPException(status_code=422, detail="Could not read this PDF. Please try another valid PDF.") from exc


async def _read_uploaded_pdf(file: UploadFile) -> tuple[str, int, list[dict[str, Any]], str]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF must be smaller than 10 MB.")
    total_pages, pages, text = _read_pdf_text(pdf_bytes)
    return file.filename, total_pages, pages, text


@app.post("/api/pdf/extract")
async def extract_pdf(file: UploadFile = File(...)):
    """Extract text from a PDF for the frontend to preview."""
    filename, total_pages, pages, text = await _read_uploaded_pdf(file)
    return {
        "status": "success",
        "filename": filename,
        "page_count": total_pages,
        "pages_with_text": len(pages),
        "pages": pages,
        "text": text,
        "text_truncated": sum(len(item["text"]) for item in pages) > len(text),
    }


@app.post("/api/pdf/summarize")
async def summarize_pdf(
    file: UploadFile = File(...),
    language: str = Form(...),
    grade: str = Form(...),
):
    """Extract PDF text and summarize it for the learner's grade and language."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI is not configured. Add OPENAI_API_KEY to backend/.env.")
    filename, total_pages, pages, document_text = await _read_uploaded_pdf(file)

    language = language.strip()
    grade = grade.strip()
    if not language or len(language) > 50:
        raise HTTPException(status_code=400, detail="Please select a valid language.")
    if not grade or len(grade) > 30:
        raise HTTPException(status_code=400, detail="Please select a valid grade.")

    summary_script_rule = (
        "Write the entire summary in natural Hinglish using ONLY Latin/Roman letters; do not use Devanagari."
        if language == "Hinglish" else
        "Write the entire summary in simple Hindi using Devanagari script, even if the source text is in English letters."
        if language == "Hindi" else
        f"Use the normal writing script for {language}."
    )
    prompt = f"""
You are BoloBodh AI, a patient tutor for Indian students.
Student grade/class: {grade}
Required summary language: {language}
Script requirement: {summary_script_rule}

Summarize the supplied PDF text for this student entirely in {language}.
Use short plain-text headings without Markdown # characters, simple explanations,
key terms, and important points separated by blank lines. Use simple bullet points
without Markdown decoration. Stay faithful to the supplied material; do not invent
details. If the extracted text appears incomplete, state that limitation in {language}.
Do not add English headings or repeat numbered labels.

PDF text:
{document_text}
""".strip()

    summary = _clean_student_text(_openai_generate_text(prompt, max_output_tokens=3500))
    return {
        "status": "success",
        "filename": filename,
        "page_count": total_pages,
        "pages_with_text": len(pages),
        "language": language,
        "grade": grade,
        "summary": summary,
        "text_truncated_for_ai": len(document_text) >= MAX_PDF_TEXT_CHARS,
    }



# ---------------------------------------------------------------------------
# PHASE 3: AI QUIZ GENERATION AND SCORING
# ---------------------------------------------------------------------------

def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse model JSON, tolerating optional Markdown code fences."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model response did not contain a JSON object.")
    parsed = json.loads(cleaned[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Model response JSON was not an object.")
    return parsed


@app.post("/api/quiz/generate")
def generate_quiz(payload: QuizRequest):
    """Generate a multiple-choice quiz from supplied PDF text or study notes."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI is not configured. Add OPENAI_API_KEY to backend/.env.")

    source_text = payload.text.strip()
    grade = payload.grade.strip()
    language = payload.language.strip()
    if len(source_text) < 30:
        raise HTTPException(status_code=422, detail="Provide at least 30 characters of study text.")
    if not grade or not language:
        raise HTTPException(status_code=422, detail="Please select the student's grade and language.")

    count = payload.num_questions
    quiz_script_rule = (
        "Write all question text, options, title, and explanations in natural Hinglish using ONLY Latin/Roman letters; do not use Devanagari."
        if language == "Hinglish" else
        "Write all question text, options, title, and explanations in simple Hindi using Devanagari script."
        if language == "Hindi" else
        f"Use the normal writing script for {language}."
    )
    prompt = f"""
You create reliable school quizzes for BoloBodh AI.
Student grade/class: {grade}
Output language: {language}
Script requirement: {quiz_script_rule}
Difficulty: {payload.difficulty}
Required number of questions: exactly {count}

Use ONLY the study source below. Write age-appropriate questions. Each question, all four option texts, the quiz title, and the explanation must
be entirely in {language}. Keep A/B/C/D only as answer-key labels. Each question
must have exactly four options labelled A, B, C, D, one unambiguously correct
answer, and a short explanation in {language}. Do not include Markdown # headings,
English feedback, or text outside the JSON object. Do not ask questions that cannot
be answered from the source.

Return exactly this JSON schema:
{{
  "title": "short quiz title in {language}",
  "questions": [
    {{
      "id": 1,
      "question": "question in {language}",
      "options": {{"A": "option", "B": "option", "C": "option", "D": "option"}},
      "correct_answer": "A",
      "explanation": "short explanation in {language}"
    }}
  ]
}}

The questions array must contain exactly {count} items and use ids 1 through {count}.

STUDY SOURCE:
{source_text[:MAX_PDF_TEXT_CHARS]}
""".strip()

    try:
        raw = _openai_generate_text(prompt, max_output_tokens=5000)
        data = _extract_json_object(raw)
        questions = data.get("questions")
        if not isinstance(questions, list) or len(questions) != count:
            raise ValueError(f"Expected exactly {count} questions.")
        validated: list[dict[str, Any]] = []
        for index, question in enumerate(questions, start=1):
            if not isinstance(question, dict):
                raise ValueError("A quiz question was not an object.")
            options = question.get("options")
            if not isinstance(options, dict) or any(key not in options for key in ("A", "B", "C", "D")):
                raise ValueError(f"Question {index} is missing one or more options.")
            correct = str(question.get("correct_answer", "")).strip().upper()
            if correct not in ("A", "B", "C", "D"):
                raise ValueError(f"Question {index} has an invalid correct answer.")
            validated.append({
                "id": index,
                "question": str(question.get("question", "")).strip(),
                "options": {key: str(options[key]).strip() for key in ("A", "B", "C", "D")},
                "correct_answer": correct,
                "explanation": str(question.get("explanation", "")).strip(),
            })
        if any(not q["question"] or any(not v for v in q["options"].values()) for q in validated):
            raise ValueError("The generated quiz contained an empty question or option.")

        return {
            "status": "success",
            "title": str(data.get("title") or "BoloBodh AI Quiz"),
            "grade": grade,
            "language": language,
            "difficulty": payload.difficulty,
            "question_count": len(validated),
            "questions": validated,
        }
    except HTTPException:
        raise
    except Exception as exc:
        print("Quiz generation failed:", type(exc).__name__, str(exc)[:1000])
        error_text = str(exc).lower()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=502, detail="Could not generate a valid quiz. Try again or shorten the study text.") from exc


@app.post("/api/quiz/grade")
def grade_quiz(payload: QuizGradeRequest):
    """Grade a quiz using the correct answers returned by /api/quiz/generate."""
    if not payload.questions:
        raise HTTPException(status_code=400, detail="No quiz questions were supplied.")

    question_map: dict[int, dict[str, Any]] = {}
    for question in payload.questions:
        try:
            question_id = int(question.get("id"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Each quiz question must have an integer id.")
        correct = str(question.get("correct_answer", "")).strip().upper()
        if correct not in ("A", "B", "C", "D"):
            raise HTTPException(status_code=400, detail=f"Question {question_id} has no valid answer key.")
        question_map[question_id] = question

    answers = {answer.question_id: answer.selected_option for answer in payload.answers}
    results = []
    score = 0
    for question_id, question in sorted(question_map.items()):
        selected = answers.get(question_id)
        correct = str(question["correct_answer"]).strip().upper()
        is_correct = selected == correct
        if is_correct:
            score += 1
        results.append({
            "question_id": question_id,
            "question": question.get("question", ""),
            "selected_option": selected,
            "correct_answer": correct,
            "is_correct": is_correct,
            "explanation": question.get("explanation", ""),
        })

    total = len(question_map)
    return {
        "status": "success",
        "score": score,
        "total": total,
        "percentage": round((score / total) * 100, 2) if total else 0,
        "results": results,
    }
