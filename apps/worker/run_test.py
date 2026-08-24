import sys
from src.engine.service import ConversionEngine

def main():
    print("Initializing ConversionEngine...")
    engine = ConversionEngine()
    
    url = "https://books.toscrape.com/"
    print(f"Creating job for {url}...")
    
    # We limit depth and pages to make the test fast
    crawl_config = {
        "depth_limit": 1,
        "max_pages": 3,
        "max_assets": 10,
        "request_timeout_seconds": 10,
    }
    
    job = engine.create_job(input_url=url, crawl_config=crawl_config)
    job_id = job["job_id"]
    print(f"Job created: {job_id}")
    
    print("Running job (Crawl -> Extract -> Infer Schema)...")
    state = engine.run_job(job_id)
    print(f"Status after run: {state['status']}")
    
    if state["status"] == "awaiting_approval":
        print("Schema proposal:")
        print(state["schema_proposal"])
        
        print("Approving schema...")
        state = engine.decide_schema(job_id, "approved")
        print(f"Status after approval: {state['status']}")
        
        print("Running job (Scaffold -> Generate -> Validate)...")
        state = engine.run_job(job_id)
        print(f"Status after second run: {state['status']}")
        
    if state["status"] == "validated":
        print("Exporting job...")
        export = engine.export_job(job_id)
        print("Export successful!")
        print("Zip path:", export.get("download", {}).get("zip_path"))
    else:
        print("Job did not finish successfully.")
        print("Errors:", state.get("errors"))

if __name__ == "__main__":
    main()
