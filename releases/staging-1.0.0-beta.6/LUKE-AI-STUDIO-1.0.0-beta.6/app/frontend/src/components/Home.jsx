import React from "react";
import { MessageSquare, Image, Film, Mic, Volume2, Boxes, ArrowRight, CheckCircle2, HardDrive, Sparkles } from "lucide-react";

const tasks = [
  { id: "chat", icon: MessageSquare, title: "Chat with AI", description: "Ask questions, write, summarize, and continue previous conversations." },
  { id: "generator", icon: Image, title: "Create an image", description: "Generate images or use references without technical setup." },
  { id: "image-video", icon: Film, title: "Animate an image", description: "Turn a still image into a short video automatically." },
  { id: "speech", icon: Mic, title: "Transcribe audio", description: "Convert speech and recordings into editable text." },
  { id: "tts", icon: Volume2, title: "Create voice", description: "Turn text into natural speech using local voices." },
  { id: "models", icon: Boxes, title: "AI Library", description: "Download and manage Text, Vision, Image, and Video models." },
];

export default function Home({ setActiveTab, specs, health, activeModel, isLlmLoaded }) {
  const ready = health?.ok !== false;
  const modelStatus = activeModel || isLlmLoaded ? "AI model ready" : "Choose a task to begin";
  const device = specs?.gpu_name && !String(specs.gpu_name).includes("Loading") ? specs.gpu_name : specs?.cpu_name || "This computer";

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-eyebrow"><Sparkles size={16} /> Simple, private, local AI</div>
        <h1>What would you like to do?</h1>
        <p>Choose a task. LUKE AI will select the safest settings for this computer automatically.</p>
        <div className="home-status-row">
          <span className={`home-status-pill ${ready ? "ready" : "attention"}`}>
            <CheckCircle2 size={16} /> {ready ? "Ready to use" : "Setup needs attention"}
          </span>
          <span className="home-status-pill"><HardDrive size={16} /> {device}</span>
          <span className="home-status-pill">{modelStatus}</span>
        </div>
      </section>

      <section className="task-grid" aria-label="Main tasks">
        {tasks.map(({ id, icon: Icon, title, description }) => (
          <button key={id} className="task-card" onClick={() => setActiveTab(id)}>
            <span className="task-card-icon"><Icon size={26} /></span>
            <span className="task-card-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight className="task-card-arrow" size={20} />
          </button>
        ))}
      </section>

      <section className="beginner-note">
        <strong>No technical knowledge required.</strong>
        <span>Advanced model, memory, and performance settings remain available when needed.</span>
      </section>
    </main>
  );
}
