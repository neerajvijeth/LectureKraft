# 🎓 AI Lecture Generator

> Transform documents into fully animated, voice-narrated educational videos instantly!

## 🚀 Overview
**AI Lecture Generator** is a powerful platform built for hackathons that takes your raw educational materials (PDFs, PowerPoints, Word docs) and synthesizes them into high-quality, engaging video lectures. It uses advanced LLMs for content structuring, RAG for precise context retrieval, Edge-TTS for lifelike voiceovers, and **Manim** for rendering beautiful programmatic animations and diagrams.

## ✨ Features
- **Intelligent Slide Generation**: Automatically extracts key concepts from uploaded documents to structure a cohesive lecture.
- **Lifelike Voiceovers**: Generates synchronized audio narration using Edge-TTS.
- **Dynamic Animations**: Programmatically generates mathematical and diagrammatic animations using the Manim engine.
- **RAG-Powered Accuracy**: Uses FastEmbed and local vector search to ensure generated content perfectly aligns with source documents.
- **Modern Web Interface**: A sleek, responsive React frontend with real-time generation previews.
- **Multi-modal Document Support**: Accepts `.pdf`, `.pptx`, `.docx`, and raw text files.

## 🛠️ Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Framer Motion, Radix UI, Zustand
- **Backend**: FastAPI, Python 3.x, Uvicorn
- **AI & Data Processing**: Groq API (Qwen models), FastEmbed (ONNX), PyPDF2, python-pptx, python-docx
- **Media Generation**: Manim (Mathematical Animation Engine), Edge-TTS, Pillow, pdf2image

## 💻 Setup & Installation

### Prerequisites
Before running the application, you need to install system-level dependencies for Manim and Media processing.

**macOS:**
```bash
brew install cairo pango pkg-config ffmpeg poppler
brew install --cask mactex-no-gui
```
*(Check `requirements.txt` for Ubuntu/Debian instructions)*

### 1. Backend Setup
```bash
# From the root of the project
# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Environment Variables
# Create a .env file in the root directory and add your API keys:
# GROQ_API_KEY=your_key
# GOOGLE_CSE_API_KEY=your_key
# GOOGLE_CSE_CX=your_cx
```

### 2. Frontend Setup
```bash
cd frontend

# Install Node dependencies
npm install

# Run the development server
npm run dev
```

### 3. Running the API Server
In a new terminal window (with the Python virtual environment activated):
```bash
uvicorn server.main:app --reload --port 8000
```

## 🎯 How It Works
1. **Upload**: Users upload their course material via the React frontend.
2. **Process**: The backend parses text, chunks it, and indexes it using a RAG pipeline.
3. **Synthesize**: The LLM drafts slide content, scripts the voiceover, and codes Manim scenes for complex concepts.
4. **Render**: The system synthesizes audio via Edge-TTS and renders animations.
5. **Compile**: Finally, everything is stitched together into a cohesive `.mp4` video lecture.

---
*Built with ❤️ for the Hackathon.*
