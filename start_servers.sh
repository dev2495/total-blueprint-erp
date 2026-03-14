#!/bin/bash
# Start Backend
echo "Starting Backend..."
cd /Users/devarshthakkar/Documents/total_blueprint_erp
source venv_311/bin/activate
# Use -u for unbuffered and --noreload to test if reloader is the issue
# If this works, we can try adding reload back later
python3 -u manage.py runserver 0.0.0.0:8000 > backend_final.log 2>&1 &
BACKEND_PID=$!
echo "Backend started with PID $BACKEND_PID"

# Start Frontend
echo "Starting Frontend..."
cd /Users/devarshthakkar/Documents/total_blueprint_erp/frontend_v2

# Prefer supported Node runtime to avoid unstable Next chunk crashes.
if [ -x "/opt/homebrew/opt/node@18/bin/node" ]; then
  export PATH="/opt/homebrew/opt/node@18/bin:$PATH"
  hash -r
fi

# Remove the next build cache to ensure all changes are recompiled
echo "Clearing Next.js cache..."
rm -rf .next

# Use -u equivalent for node if needed, but usually not necessary
NEXT_DISABLE_CACHE=1 DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1 npm run dev -- -p 3000 > frontend_final.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend started with PID $FRONTEND_PID"

# Disown processes
disown $BACKEND_PID
disown $FRONTEND_PID

echo "Processes disowned. Checking port status in 5 seconds..."
sleep 5
lsof -i :8000,3000
