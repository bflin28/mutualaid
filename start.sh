#!/bin/bash

# Mutual Aid App - Development Startup Script
# Starts all services: Frontend, Node.js API, and Python API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Mutual Aid App...${NC}"

# Cleanup function to kill all background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down all services...${NC}"
    kill $(jobs -p) 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start Python FastAPI backend
echo -e "${GREEN}Starting Python API (port 5055)...${NC}"
(cd training/peft && source ../../.venv/bin/activate && uvicorn slack_api:app --reload --port 5055) &

# Start Node.js API server
echo -e "${GREEN}Starting Node.js API (port 4000)...${NC}"
npm run server &

# Give servers a moment to start
sleep 2

# Start Frontend (Vite dev server)
echo -e "${GREEN}Starting Frontend (port 5173)...${NC}"
npm run dev &

echo -e "\n${GREEN}All services started!${NC}"
echo -e "  Frontend:   http://localhost:5173"
echo -e "  Node.js API: http://localhost:4000"
echo -e "  Python API:  http://localhost:5055"
echo -e "\n${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Wait for all background processes
wait
