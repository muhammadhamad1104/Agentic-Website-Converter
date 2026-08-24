import asyncio
from src.engine.service import ConversionEngine
import time

engine = ConversionEngine()
job_id = "1d9ccb72-6ade-4081-bbf0-469edc33ae97"
job = engine.store.get_job(job_id)
print(f"Status before: {job.status.value}")

start = time.time()
result = engine.run_job(job_id, target_stage="generate")
print(f"Time taken: {time.time() - start:.2f}s")
print(f"Status after: {result['status']}")
print(f"Errors: {result['errors']}")
print(f"Trace events length: {len(result['trace_events'])}")

if len(result['trace_events']) > 0:
    print(f"Last trace event: {result['trace_events'][-1]['node']}")
