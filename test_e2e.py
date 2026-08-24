import requests
import time
import sys

import os

BASE_URL = os.getenv("API_URL", "http://localhost:5000/api")

def main():
    print("Testing E2E Conversion Pipeline...")
    
    # 1. Register or Login
    email = "muhammadhamad1104@gmail.com"
    password = "password123"
    
    res = requests.post(f"{BASE_URL}/auth/register", json={
        "name": "Test Admin",
        "email": email,
        "password": password
    })
    
    if res.status_code == 409:
        print("User exists, logging in...")
        res = requests.post(f"{BASE_URL}/auth/login", json={
            "email": email,
            "password": password
        })
    
    if not res.ok:
        print("Auth failed:", res.text)
        sys.exit(1)
        
    token = res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("Authenticated successfully.")
    
    # 2. Create a site
    res = requests.post(f"{BASE_URL}/sites", headers=headers, json={
        "url": "https://getbootstrap.com/",
        "name": "Bootstrap Demo",
        "sourceType": "URL"
    })
    
    if not res.ok:
        print("Failed to create site:", res.text)
        sys.exit(1)
        
    site = res.json()["site"]
    site_id = site["id"]
    print(f"Created site: {site_id}")
    
    # 3. Create a job
    res = requests.post(f"{BASE_URL}/jobs", headers=headers, json={
        "siteId": site_id,
        "url": "https://getbootstrap.com/",
        "extractImages": False
    })
    
    if not res.ok:
        print("Failed to create job:", res.text)
        sys.exit(1)
        
    job = res.json()["job"]
    job_id = job["id"]
    print(f"Created job: {job_id}")
    
    # 4. Poll job status
    print("Polling job status (timeout in 300s)...")
    for _ in range(60):
        res = requests.get(f"{BASE_URL}/jobs/{job_id}", headers=headers)
        if not res.ok:
            print("Failed to get job status:", res.text)
            sys.exit(1)
            
        status = res.json()["job"]["status"]
        print(f"Status: {status}")
        
        if status in ["COMPLETED", "FAILED", "ERROR"]:
            print(f"Job finished with status: {status}")
            break
            
        time.sleep(5)
        
if __name__ == "__main__":
    main()
