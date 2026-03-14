import functools
import logging
import traceback

logger = logging.getLogger(__name__)

def safe_service(default_value=None):
    """
    Decorator to wrap service methods and return a safe default value if they crash.
    Used for production hardening in Phase 27.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(f"Service Failure in {func.__name__}: {str(e)}")
                logger.error(traceback.format_exc())
                
                # Return intelligence-safe defaults if not provided
                if default_value is not None:
                    return default_value
                
                # Heuristic for default values
                # If we can't determine, return 0 or empty structures based on Rule 1
                return 0 # Default to 0 if unsure
        return wrapper
    return decorator
