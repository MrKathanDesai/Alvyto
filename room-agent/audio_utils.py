import io
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def log_audio_stats(audio_data: bytes, source: str = "unknown"):
    """
    Logs basic statistics about the received audio data.
    """
    size_kb = len(audio_data) / 1024
    logger.info(f"Received audio chunk from {source}: {size_kb:.2f} KB")
