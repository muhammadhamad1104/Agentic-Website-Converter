import sqlite3
import json

conn = sqlite3.connect('apps/worker/data/conversion_jobs.db')
c = conn.cursor()
c.execute("SELECT id, crawl_artifacts, extraction_report FROM conversion_jobs LIMIT 3")
for row in c.fetchall():
    job_id, ca_str, er_str = row
    ca = json.loads(ca_str) if ca_str else {}
    er = json.loads(er_str) if er_str else {}
    print(f"Job: {job_id}")
    print(f"crawl_artifacts.assets type: {type(ca.get('assets'))}")
    if ca.get('assets') is not None:
        print(f"crawl_artifacts.assets length: {len(ca.get('assets'))}")
    print(f"crawl_artifacts.totals: {ca.get('totals')}")
    print(f"extraction_report.assets type: {type(er.get('assets'))}")
