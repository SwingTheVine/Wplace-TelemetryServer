#!/bin/sh
# ============================================
# Startup script for Node.js + Cloudflared
# Works even if chmod/x flag fails
# ============================================

pwd

# Load environment variables from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DEBUG=${DEBUG:-false}
echo "Starting container at $(date)"
echo "Debug mode: $DEBUG"

# 1️⃣ Start Cloudflared tunnel in background
CLOUDFLARED_DIR=./cloudflared
CLOUDFLARED_LOG=cloudflared.log
CLOUDFLARED_CMD="$CLOUDFLARED_DIR/cloudflared tunnel --config $CLOUDFLARED_DIR/config.yml run"

echo "Starting Cloudflared tunnel..."
chmod +x ./cloudflared/cloudflared
if [ "$DEBUG" = "true" ]; then
  ls -l /home/container/cloudflared # Output the contents of the cloudflared directory
  sh -c "$CLOUDFLARED_CMD" & # Use sh to run binary in debug mode (stdout/stderr to console)
else
  # Run in background and log output to file
  sh -c "$CLOUDFLARED_CMD" >> "$CLOUDFLARED_LOG" 2>&1 &
fi
CLOUDFLARED_PID=$!
echo "Cloudflared PID: $CLOUDFLARED_PID"

# Wait a few seconds to let Cloudflared initialize
sleep 3

echo "Assume the Cloudflared tunnel is established."

# 2️⃣ Start Node.js server
if [ "$DEBUG" = "true" ]; then
  echo "Starting Node.js server in debug mode..."
  node server.js
else
  echo "Starting Node.js server..."
  node server.js >> node.log 2>&1
fi

# Optional: wait for Cloudflared process when Node exits
wait $CLOUDFLARED_PID
