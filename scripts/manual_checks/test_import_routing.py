
import sys
import os

# Add the current directory to sys.path
sys.path.append(os.getcwd())

print("Attempting to import apps.routing...")
try:
    import apps.routing
    print("Successfully imported apps.routing")
except Exception as e:
    print(f"Failed to import apps.routing: {e}")

print("Attempting to import apps.routing.models...")
try:
    import apps.routing.models
    print("Successfully imported apps.routing.models")
except Exception as e:
    print(f"Failed to import apps.routing.models: {e}")
