
import { useState, useEffect } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  FileText,
  GraduationCap,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Mic,
  Sparkles,
  UserRound,
  Volume2,
  Eye,
  EyeOff,
  ClipboardList,
} from "lucide-react";
import { supabase } from "./supabase";
import StudentDashboard from "./StudentDashboard";
import "./App.css";

const languages = [
  { number: "01", native: "English", name: "English", code: "en-IN" },
  { number: "02", native: "हिन्दी", name: "Hindi", code: "hi-IN" },
  { number: "03", native: "தமிழ்", name: "Tamil", code: "ta-IN" },
  { number: "04", native: "বাংলা", name: "Bengali", code: "bn-IN" },
  { number: "05", native: "తెలుగు", name: "Telugu", code: "te-IN" },
  { number: "06", native: "ಕನ್ನಡ", name: "Kannada", code: "kn-IN" },
  { number: "07", native: "മലയാളം", name: "Malayalam", code: "ml-IN" },
  { number: "08", native: "मराठी", name: "Marathi", code: "mr-IN" },
  { number: "09", native: "ગુજરાતી", name: "Gujarati", code: "gu-IN" },
  { number: "10", native: "ਪੰਜਾਬੀ", name: "Punjabi", code: "pa-IN" },
];

const learningFeatures = [
  {
    icon: Mic,
    number: "01",
    title: "Ask it your way",
    description:
      "Speak a doubt or type a question. Start from what you already understand.",
  },
  {
    icon: FileText,
    number: "02",
    title: "Bring your textbook",
    description:
      "Use your own study material as the starting point for explanations.",
  },
  {
    icon: ClipboardList,
    number: "03",
    title: "Practice with purpose",
    description:
      "Prepare for a topic with a quiz tailored to your class and language.",
  },
  {
    icon: BookOpen,
    number: "04",
    title: "Keep the key ideas",
    description:
      "Turn difficult concepts into notes you can revisit before an exam.",
  },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [quizCount, setQuizCount] = useState(10);
  const [quizLanguage, setQuizLanguage] = useState("Hindi");
  const [selectedLanguage, setSelectedLanguage] = useState("English");

  const isSignup = mode === "signup";

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (!mounted) return;

      if (sessionError) {
        console.error("Unable to restore session:", sessionError.message);
      }

      setUser(data?.session?.user ?? null);
      setCheckingSession(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setCheckingSession(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  function changeMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    setError("");
    setPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (isSignup && !name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (password.length < 6) {
      setError("Your password must contain at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      if (isSignup) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        });

        if (authError) throw authError;

        if (data.session?.user) {
          setUser(data.session.user);
          setMessage("");
        } else {
          setMessage(
            "Account created. Check your email for a confirmation link before signing in."
          );
        }
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (authError) throw authError;

        setUser(data.user);
        setMessage("");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const { error: authError } =
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
          },
        });

      if (authError) throw authError;
    } catch (err) {
      setError(err.message || "Google sign-in could not be started.");
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }

    setLoading(true);

    try {
      const { error: authError } =
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/`,
        });

      if (authError) throw authError;

      setMessage(
        "If an account exists for this email, a password reset link will be sent."
      );
    } catch (err) {
      setError(err.message || "Unable to request a password reset.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const { error: logoutError } = await supabase.auth.signOut();

    if (logoutError) {
      window.alert(`Unable to sign out: ${logoutError.message}`);
    }
  }

  if (checkingSession) {
    return (
      <main className="app-shell">
        <p style={{ padding: "40px", textAlign: "center" }}>
          Loading your learning space...
        </p>
      </main>
    );
  }

  if (user) {
    return <StudentDashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="BoloBodh AI home">
          <span className="brand-mark">
            <BookOpen size={23} strokeWidth={1.9} />
          </span>
          <span className="brand-name">
            BoloBodh<span> AI</span>
          </span>
        </a>

        <a className="header-link" href="#how-it-works">
          How it works <ArrowDown size={14} />
        </a>

        <a className="header-cta" href="#account">
          Start learning <ArrowRight size={15} />
        </a>
      </header>

      <section className="intro-section" id="home">
        <div className="intro-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            A DIFFERENT WAY TO UNDERSTAND
          </div>

          <h1>
            Your language.
            <br />
            <em>Your learning.</em>
            <br />
            Your future.
          </h1>

          <p className="intro-description">
            Big questions deserve clear explanations. Speak a doubt, explore
            your textbook, and learn at your own pace—with a tutor designed
            around the way you learn.
          </p>

          <div className="intro-actions">
            <a className="primary-link" href="#account">
              Find your learning space <ArrowRight size={17} />
            </a>
            <a className="secondary-link" href="#how-it-works">
              Explore the idea
            </a>
          </div>

          <div className="intro-note">
            <span className="note-line" />
            Built around understanding, not just answers.
          </div>
        </div>

        <div
          className="study-scene"
          aria-label="Illustration of a learning notebook"
        >
          <div className="scene-topline">
            <span>YOUR STUDY DESK</span>
            <span className="scene-dot">●</span>
            <span>A PLACE TO BEGIN</span>
          </div>

          <div className="scene-paper paper-back">
            <span className="paper-label">A SMALL REMINDER</span>
            <p>It's okay to ask again.</p>
            <span className="paper-underline" />
          </div>

          <div className="scene-paper paper-front">
            <div className="paper-heading">
              <span className="paper-icon">
                <BookOpen size={19} />
              </span>
              <span>LEARNING NOTE / 001</span>
            </div>

            <p className="paper-question">
              What if a difficult topic
              <br />
              could be explained simply?
            </p>

            <div className="paper-rule" />
            <div className="paper-rule short" />

            <div className="paper-bottom">
              <span>
                <Sparkles size={15} /> One concept at a time
              </span>
              <span>01 / 04</span>
            </div>
          </div>

          <div className="scene-sticker sticker-language">
            <Languages size={17} />
            <span>Learn your way</span>
          </div>

          <div className="scene-sticker sticker-audio">
            <Volume2 size={17} />
            <span>Listen &amp; understand</span>
          </div>

          <span className="scene-decoration decoration-one" />
          <span className="scene-decoration decoration-two" />
        </div>
      </section>

      <section className="language-section" aria-labelledby="language-title">
        <div className="section-kicker">A MORE PERSONAL WAY TO LEARN</div>

        <div className="language-heading">
          <div>
            <h2 id="language-title">Start with the language you think in.</h2>
            <p>
              Choose a language for your learning experience. Availability
              will depend on the speech and AI models connected to the app.
            </p>
          </div>
          <Languages className="language-heading-icon" size={32} />
        </div>

        <div className="language-grid">
          {languages.map((language) => (
            <button
              type="button"
              className={`language-card ${
                selectedLanguage === language.name ? "language-card-active" : ""
              }`}
              key={language.code}
              onClick={() => {
                setSelectedLanguage(language.name);
                setQuizLanguage(language.name);
              }}
              aria-pressed={selectedLanguage === language.name}
            >
              <span className="language-index">{language.number}</span>
              <span className="language-native">{language.native}</span>
              <span className="language-label">{language.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="features-section" id="how-it-works">
        <div className="features-intro">
          <div>
            <div className="section-kicker">FROM DOUBT TO UNDERSTANDING</div>
            <h2>
              One study space.
              <br />
              More ways to learn.
            </h2>
          </div>
          <p>
            Start with a question. Build on it with an explanation, study
            material, practice, and notes—all in one learning journey.
          </p>
        </div>

        <div className="feature-grid">
          {learningFeatures.map((feature) => {
            const Icon = feature.icon;

            return (
              <article className="feature-card" key={feature.number}>
                <div className="feature-card-top">
                  <span className="feature-icon">
                    <Icon size={21} />
                  </span>
                  <span className="feature-number">{feature.number}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="quiz-section" aria-labelledby="quiz-title">
        <div className="quiz-copy">
          <div className="section-kicker">PRACTICE THAT MAKES SENSE</div>
          <h2>
            Not just a lesson.
            <br />A chance to test yourself.
          </h2>
          <p>
            The planned quiz mode will generate multiple-choice questions
            around a topic, class level, and preferred language. Answer,
            review your result, and revisit the concepts that need more work.
          </p>

          <div className="quiz-points">
            <span>
              <Check size={16} /> 10–20 MCQs per practice session
            </span>
            <span>
              <Check size={16} /> Questions in your chosen language
            </span>
            <span>
              <Check size={16} /> Review answers and explanations
            </span>
          </div>
        </div>

        <div className="quiz-preview">
          <div className="quiz-preview-header">
            <div className="quiz-preview-title">
              <span className="quiz-symbol">
                <Brain size={20} />
              </span>
              <span>
                <strong>Practice builder</strong>
                <small>Choose your practice settings</small>
              </span>
            </div>
            <span className="preview-label">PREVIEW</span>
          </div>

          <label className="quiz-label">Number of questions</label>
          <div className="quiz-count-options">
            {[10, 15, 20].map((count) => (
              <button
                type="button"
                key={count}
                className={quizCount === count ? "count-active" : ""}
                onClick={() => setQuizCount(count)}
                aria-pressed={quizCount === count}
              >
                {count} questions
              </button>
            ))}
          </div>

          <label className="quiz-label" htmlFor="quiz-language">
            Practice language
          </label>

          <div className="quiz-select-wrap">
            <Languages size={17} />
            <select
              id="quiz-language"
              value={quizLanguage}
              onChange={(event) => {
                const nextLanguage = event.target.value;
                setQuizLanguage(nextLanguage);
                setSelectedLanguage(nextLanguage);
              }}
            >
              {languages.map((language) => (
                <option key={language.code} value={language.name}>
                  {language.name} — {language.native}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>

          <div className="quiz-summary">
            <span className="summary-icon">
              <ClipboardList size={20} />
            </span>
            <span>
              <strong>{quizCount} multiple-choice questions</strong>
              <small>Preferred language: {quizLanguage}</small>
            </span>
          </div>

          <p className="quiz-preview-note">
            This is a settings preview. Quiz generation will be connected to
            the tutor backend in a later phase.
          </p>
        </div>
      </section>

      <section className="account-section" id="account">
        <div className="account-intro">
          <div className="section-kicker">YOUR NEXT CHAPTER STARTS HERE</div>
          <h2>
            Come curious.
            <br />
            <em>Leave understanding.</em>
          </h2>
          <p>
            Create your account to begin building a learning space that
            grows with you.
          </p>
          <div className="account-note">
            <BookOpen size={20} />
            <span>Questions are the beginning of learning.</span>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="auth-mark">
              {isSignup ? (
                <GraduationCap size={23} />
              ) : (
                <BookOpen size={23} />
              )}
            </span>
            <div>
              <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
              <p>
                {isSignup
                  ? "Your personal learning space is a step away."
                  : "Sign in to continue your learning journey."}
              </p>
            </div>
          </div>

          <div className="mode-switch" aria-label="Authentication mode">
            <button
              type="button"
              className={isSignup ? "mode-active" : ""}
              onClick={() => changeMode("signup")}
            >
              Create account
            </button>
            <button
              type="button"
              className={!isSignup ? "mode-active" : ""}
              onClick={() => changeMode("login")}
            >
              Sign in
            </button>
          </div>

          <button
            type="button"
            className="google-button"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
              />
              <path
                fill="#34A853"
                d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2A20 20 0 0 0 24 44Z"
              />
              <path
                fill="#FBBC05"
                d="M12.6 27.5a12 12 0 0 1 0-7V15.3H5.8a20 20 0 0 0 0 17.4l6.8-5.2Z"
              />
              <path
                fill="#EA4335"
                d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8A19.5 19.5 0 0 0 24 4 20 20 0 0 0 5.8 15.3l6.8 5.2c1.6-4.8 6.1-8.4 11.4-8.4Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="divider">
            <span />
            <small>OR USE YOUR EMAIL</small>
            <span />
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignup && (
              <label className="field">
                <span>Full name</span>
                <div className="input-wrap">
                  <UserRound size={17} />
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
              </label>
            )}

            <label className="field">
              <span>Email address</span>
              <div className="input-wrap">
                <Mail size={17} />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>Password</span>
              <div className="input-wrap">
                <LockKeyhole size={17} />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    isSignup ? "new-password" : "current-password"
                  }
                  placeholder="At least 6 characters"
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  {showPassword ? (
                    <EyeOff size={17} />
                  ) : (
                    <Eye size={17} />
                  )}
                </button>
              </div>
            </label>

            {!isSignup && (
              <button
                type="button"
                className="forgot-link"
                onClick={handleForgotPassword}
                disabled={loading}
              >
                Forgot password?
              </button>
            )}

            {error && (
              <div className="notice error-notice" role="alert">
                {error}
              </div>
            )}

            {message && (
              <div className="notice success-notice" role="status">
                {message}
              </div>
            )}

            <button
              className="submit-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={18} />
                  Please wait...
                </>
              ) : (
                <>
                  {isSignup ? "Create my account" : "Sign in"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <p className="terms">
            By continuing, you agree to use BoloBodh AI responsibly and
            respect our learning community.
          </p>
        </div>
      </section>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#home">
          <span className="brand-mark">
            <BookOpen size={20} />
          </span>
          <span className="brand-name">
            BoloBodh<span> AI</span>
          </span>
        </a>
        <p>Learn at your pace. Understand in your language.</p>
        <span>© {new Date().getFullYear()} BoloBodh AI</span>
      </footer>
    </main>
  );
}
