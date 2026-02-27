#!/bin/bash

# Alvyto - Unified Setup and Run Script
# This script sets up the environment and runs the Room Agent, Backend, and Frontend.

echo "🚀 Starting Alvyto Setup & Run Script..."

# 1. Check for system dependencies
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ Error: ffmpeg is not installed. Please install it (e.g., 'brew install ffmpeg')."
    exit 1
fi

# 2. Setup Backend Environment
echo "📦 Setting up Backend Python environment..."
if [ ! -d "venv" ]; then
    python3.11 -m venv venv
    echo "✅ Created virtual environment."
fi

source venv/bin/activate
pip install -r backend/requirements.txt
echo "✅ Backend dependencies installed."

# 2.1 Seed Database if missing
if [ ! -f "emr.db" ]; then
    echo "🗄️ Database not found. Seeding initial data..."
    python3 -m backend.seed
    echo "✅ Database seeded."
fi

# 3. Setup Frontend Environment
echo "📦 Setting up Frontend dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo "✅ Frontend dependencies installed."
fi

# 4. Function to cleanup processes on exit
cleanup() {
    echo -e "\n🛑 Stopping all services..."
    kill $(jobs -p)
    exit
}

trap cleanup SIGINT SIGTERM

# 5. Start Services
echo "🎬 Starting Room Agent (Transcription Service) on port 8000..."
(cd room-agent && ./start.sh) &

echo "🎬 Starting Data Backend on port 8080..."
source venv/bin/activate && python3 -m backend.server &

echo "🎬 Starting Frontend (Next.js) on port 3000..."
npm run dev &

echo "✨ All services are starting. Open http://localhost:3000 in your browser."
wait
