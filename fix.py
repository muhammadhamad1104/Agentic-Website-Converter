import json, sqlite3
conn = sqlite3.connect("apps/worker/data/conversion_jobs.db")
c = conn.cursor()
c.execute("SELECT crawl_config FROM conversion_jobs ORDER BY created_at DESC LIMIT 1")
row = c.fetchone()
if row and row[0]:
    config = json.loads(row[0])
    print("max_assets in config:", config.get("max_assets"))
