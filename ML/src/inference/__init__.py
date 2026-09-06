"""
Inference Package for R2 ML.
"""

from src.inference.predict import (
    InferencePipeline,
    get_inference_pipeline,
    predict,
)

__all__ = [
    "InferencePipeline",
    "get_inference_pipeline",
    "predict",
]
